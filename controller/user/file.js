const { cloudinaryUpload } = require('../../util/cloudinary');
const fileModel = require('../../models/file');
const axios = require('axios');
const fs = require('fs');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');
const XLSX = require('xlsx');
const facebookfilemodel = require('../../models/facebookfile');

function extractProductIdFromUrl(url) {
    try {
       
        const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})|\/product\/([A-Z0-9]{10})/i);
        if (asinMatch) {
            return asinMatch[1] || asinMatch[2];
        }
        
      
        const walmartMatch = url.match(/\/ip\/.*?\/(\d+)/);
        if (walmartMatch) {
            return walmartMatch[1];
        }
        
     
        if (/^[A-Z0-9]{10}$/i.test(url) || /^\d+$/.test(url)) {
            return url;
        }
        
        return null;
    } catch (error) {
        console.error('Error extracting product ID:', error.message);
        return null;
    }
}


async function fetchWalmartProduct(itemId) {
    const url = `https://realtime-walmart-data.p.rapidapi.com/product?itemId=${itemId}`;
    
    const options = {
        method: 'GET',
        url: url,
        headers: {
            'x-rapidapi-host': 'realtime-walmart-data.p.rapidapi.com',
            'x-rapidapi-key': 'b9f300ae50msh337f637e3b499b7p149d11jsnc68359967c0f'
        }
    };
    
    try {
        console.log(`🔍 Fetching Walmart product: ${itemId}`);
        const response = await axios(options);
        return response.data;
    } catch (error) {
        console.error(`❌ Error fetching product ${itemId}:`, error.message);
        return null;
    }
}


async function fetchSellerDetails(catalogSellerId) {
    console.log("catalogsllerid")
    console.log(catalogSellerId)
    const url = `https://realtime-walmart-data.p.rapidapi.com/sellerDetails?catalogSellerId=${catalogSellerId}`;
    
    const options = {
        method: 'GET',
        url: url,
        headers: {
            'x-rapidapi-host': 'realtime-walmart-data.p.rapidapi.com',
            'x-rapidapi-key': 'b9f300ae50msh337f637e3b499b7p149d11jsnc68359967c0f'
        }
    };
    
    try {
        console.log(`🏪 Fetching seller: ${catalogSellerId}`);
        const response = await axios(options);
        console.log("SELLER DATA")
        console.log(response.data)
        return response.data;
    } catch (error) {
        console.error(`❌ Error fetching seller ${catalogSellerId}:`, error.message);
        return null;
    }
}

// Helper function to read CSV file and extract records
async function readCSVFile(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
}

// Helper function to read Excel file and extract records
async function readExcelFile(filePath) {
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0]; // Get first sheet
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        return jsonData;
    } catch (error) {
        throw new Error(`Failed to read Excel file: ${error.message}`);
    }
}

// Helper function to determine file type and read accordingly
async function readFile(filePath, originalName) {
    const fileExtension = originalName.toLowerCase().split('.').pop();
    
    if (fileExtension === 'csv') {
        return await readCSVFile(filePath);
    } else if (fileExtension === 'xls' || fileExtension === 'xlsx') {
        return await readExcelFile(filePath);
    } else {
        throw new Error('Unsupported file format. Please upload CSV or Excel files.');
    }
}

// Main controller function
module.exports.enrichifyFile = async (req, res) => {
    let filePath = null;
    let outputFilePath = null;
    
    try {
        if (!req.file) {
            return res.status(400).json({
                error: 'No file uploaded'
            });
        }

        filePath = req.file.path;
        const originalFileName = req.file.originalname;
        const userId = req.user?._id;
        
        console.log('📁 Processing file:', filePath);
        console.log('📄 Original filename:', originalFileName);
        
        // Read the file (CSV or Excel)
        const records = await readFile(filePath, originalFileName);
        console.log(`📊 Found ${records.length} records to process`);
        
        if (records.length === 0) {
            return res.status(400).json({
                error: 'No records found in the file'
            });
        }
        
        // Array to store enriched data
        const enrichedData = [];
        
        // Process each record
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            console.log(`\n🔄 Processing record ${i + 1}/${records.length}`);
            
            // Extract URL from record (adjust field names based on your CSV structure)
            const productUrl = record.url || record.link || record.product_url || record.productUrl || record.URL;
            
            if (!productUrl) {
                console.log('⚠️ No product URL found in record, skipping...');
                enrichedData.push({
                    ...record,
                    enrichment_status: 'failed',
                    enrichment_error: 'No product URL found'
                });
                continue;
            }
            
            // Extract product ID from URL
            const productId = extractProductIdFromUrl(productUrl);
            
            if (!productId) {
                console.log('⚠️ Could not extract product ID from URL, skipping...');
                enrichedData.push({
                    ...record,
                    enrichment_status: 'failed',
                    enrichment_error: 'Could not extract product ID from URL'
                });
                continue;
            }
            
            console.log(`🆔 Extracted product ID: ${productId}`);
            
            // Fetch product data
            const productData = await fetchWalmartProduct(productId);
            
            if (!productData) {
                enrichedData.push({
                    ...record,
                    enrichment_status: 'failed',
                    enrichment_error: 'Failed to fetch product data'
                });
                continue;
            }
            
            // Fetch seller data if catalogSellerId exists
            let sellerData = null;
            console.log("PRODUCTDATANEW")
            console.log(JSON.stringify(productData))
            if (productData.catalogSellerId) {

                console.log("productsdata catalogid")
                console.log(productData.catalogSellerId)
                sellerData = await fetchSellerDetails(productData.catalogSellerId);
            }
            
            // Combine all data
            const enrichedRecord = {
                ...record,
                enrichment_status: 'success',
                extracted_product_id: productId,
              
                
                product_rating: productData.rating || '',
              
               
                product_brand: productData.brand || '',
                product_category: productData.category || '',
                product_description: productData.description || '',
                product_main_image: productData.mainImage || '',
                seller_id: productData.catalogSellerId || '',
                seller_name: sellerData?.sellerName || '',
                seller_rating: sellerData?.rating || '',
                seller_email: sellerData?.sellerEmail || '',
                seller_phone: sellerData?.sellerPhone || '',
                seller_address_line1: sellerData?.seller_address?.address1 || '',
                seller_address_line2: sellerData?.seller_address?.address2 || '',
                seller_city: sellerData?.seller_address?.city || '',
                seller_country: sellerData?.seller_address?.country || '',
                seller_postal_code: sellerData?.seller_address?.postalCode || '',
                
               
               
                enriched_at: new Date().toISOString()
            };
            
            enrichedData.push(enrichedRecord);
            console.log(`✅ Successfully enriched record ${i + 1}`);
            
            // Add delay to avoid rate limiting (adjust as needed)
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Create enriched CSV file
        const outputFileName = `enriched-${Date.now()}.csv`;
        outputFilePath = `/tmp/public/files/uploads/${outputFileName}`;
        
        // Ensure uploads directory exists
        if (!fs.existsSync('/tmp/public/files/uploads')) {
            fs.mkdirSync('/tmp/public/files/uploads', { recursive: true });
        }
        
        // Get all unique headers
        const headers = [...new Set(
            enrichedData.flatMap(obj => Object.keys(obj))
        )].map(key => ({ id: key, title: key }));
        
        const csvWriter = createObjectCsvWriter({
            path: outputFilePath,
            header: headers
        });
        
        await csvWriter.writeRecords(enrichedData);
        console.log(`✅ Enriched data saved to: ${outputFilePath}`);
        
        // Upload original file to Cloudinary first
        console.log('☁️ Uploading original file to Cloudinary...');
        console.log('File path:', filePath);
        console.log('File exists:', fs.existsSync(filePath));
        
        let originalFileCloudinary;
        try {
            originalFileCloudinary = await cloudinaryUpload(filePath);
            console.log('Cloudinary response for original file:', originalFileCloudinary);
        } catch (cloudinaryError) {
            console.error('Cloudinary upload error:', cloudinaryError);
            throw new Error(`Cloudinary upload failed: ${cloudinaryError.message}`);
        }
        
        // Check for both secure_url and url properties (for compatibility)
        const originalFileUrl = originalFileCloudinary?.secure_url || originalFileCloudinary?.url;
        
        if (!originalFileUrl) {
            throw new Error('Failed to upload original file to Cloudinary - no URL returned');
        }
        console.log('✅ Original file uploaded:', originalFileUrl);
        
        // Upload enriched file to Cloudinary
        console.log('☁️ Uploading enriched file to Cloudinary...');
        console.log('Output file path:', outputFilePath);
        console.log('Output file exists:', fs.existsSync(outputFilePath));
        
        let cloudinaryResult;
        try {
            cloudinaryResult = await cloudinaryUpload(outputFilePath);
            console.log('Cloudinary response for enriched file:', cloudinaryResult);
        } catch (cloudinaryError) {
            console.error('Cloudinary upload error:', cloudinaryError);
            throw new Error(`Cloudinary upload failed: ${cloudinaryError.message}`);
        }
        
        // Check for both secure_url and url properties (for compatibility)
        const enrichedFileUrl = cloudinaryResult?.secure_url || cloudinaryResult?.url;
        
        if (!enrichedFileUrl) {
            throw new Error('Failed to upload enriched file to Cloudinary - no URL returned');
        }
        console.log('✅ Enriched file uploaded:', enrichedFileUrl);
        
        // Calculate statistics
        const successCount = enrichedData.filter(r => r.enrichment_status === 'success').length;
        const failedCount = enrichedData.filter(r => r.enrichment_status === 'failed').length;
        
        // Generate a random 6-digit passcode
        const passcode = Math.floor(100000 + Math.random() * 900000).toString();
        
        console.log("SAVING IN DB!")
        console.log(userId)
        // Save file info to database
        const fileRecord = await fileModel.create({
            file: originalFileUrl,
            user: userId,
            paid: false,
            passcode: passcode,
            output: enrichedFileUrl,
            recordCount: records.length.toString(),
            recordLength: records.length
        });
        
        console.log('✅ File record saved to database');
        
        // Clean up local files
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('🗑️ Cleaned up original file');
        }
        if (outputFilePath && fs.existsSync(outputFilePath)) {
            fs.unlinkSync(outputFilePath);
            console.log('🗑️ Cleaned up enriched file');
        }
        
        console.log('\n✅ File enrichment completed!');
        console.log(`📊 Total: ${records.length} | Success: ${successCount} | Failed: ${failedCount}`);
        
        return res.status(200).json({
            message: 'File enriched successfully',
            data: {
                fileId: fileRecord._id,
                passcode: passcode,
                originalFileUrl: originalFileUrl,
                enrichedFileUrl: enrichedFileUrl,
                totalRecords: records.length,
                successfulEnrichments: successCount,
                failedEnrichments: failedCount,
                successRate: `${((successCount / records.length) * 100).toFixed(2)}%`,
                paid: false,
                message: 'Payment required to download the enriched file'
            }
        });
        
    } catch (e) {
        console.log('❌ Error:', e.message);
        console.error(e);
        
        // Clean up files on error
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        if (outputFilePath && fs.existsSync(outputFilePath)) {
            fs.unlinkSync(outputFilePath);
        }
        
        return res.status(400).json({
            error: 'Error occurred while trying to enrich file',
            details: e.message
        });
    }
};





module.exports.payForUpload=async(req,res)=>{
    try {
      const { amount, recordCount,recordId } = req.body;
      const stripe = require('stripe')("sk_test_51OwuO4LcfLzcwwOYsXYljgE1gUyGnLFvjewSf1NG9CsrSqTsxm7n7ppmZ2ZIFL01ptVDhuW7LixPggik41wWmOyE00RjWnYxUA"); // Add your Stripe secret key
  
  
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
      }
  
      console.log("STRIPE")
      console.log(recordId)
    
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        metadata: {
          recordCount: recordCount,
          userId: req.user.id 
        }
      });

      await fileModel.updateOne(
        {
          $expr: {
            $eq: [{ $toString: "$_id" }, recordId]
          }
        },
        {
          $set: {
            paid: true
          }
        }
      );
      
  
     return res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id
      });
    } catch (error) {
      console.error('Error creating payment intent:', error);
     return res.status(500).json({ error: 'Failed to create payment intent' });
    }
  }


  module.exports.payForFaceUpload=async(req,res)=>{
    try {
      const { amount, recordCount,recordId } = req.body;
      const stripe = require('stripe')("sk_test_51OwuO4LcfLzcwwOYsXYljgE1gUyGnLFvjewSf1NG9CsrSqTsxm7n7ppmZ2ZIFL01ptVDhuW7LixPggik41wWmOyE00RjWnYxUA"); // Add your Stripe secret key
  
  
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
      }
  
      console.log("STRIPE")
      console.log(recordId)
    
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        metadata: {
          recordCount: recordCount,
          userId: req.user.id 
        }
      });

      await facebookfilemodel.updateOne(
        {
          $expr: {
            $eq: [{ $toString: "$_id" }, recordId]
          }
        },
        {
          $set: {
            paid: true
          }
        }
      );
      
  
     return res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id
      });
    } catch (error) {
      console.error('Error creating payment intent:', error);
     return res.status(500).json({ error: 'Failed to create payment intent' });
    }
  }

  module.exports.getAllOrders=async(req,res)=>{
    try{
        
let allFiles=await fileModel.find({user:req.user._id})

return res.status(200).json({
    allFiles
})
    }catch(e){
        cosnsole.log(e.message)
        return res.status(400).json({
            error:"Error while trying to fetch orders for user"
        })
    }
  }




  module.exports.getAllFacebookOrders=async(req,res)=>{
    try{
        
let allFiles=await facebookfilemodel.find({user:req.user._id})

return res.status(200).json({
    allFiles
})
    }catch(e){
        cosnsole.log(e.message)
        return res.status(400).json({
            error:"Error while trying to fetch orders for user"
        })
    }
  }




//newnew
const puppeteer = require('puppeteer');
const FACEBOOK_EMAIL = 'shahg33285@gmail.com'; 
const FACEBOOK_PASSWORD = 'dawaralibukhari';

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function readCSVFile(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

async function readExcelFile(filePath) {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    return jsonData;
  } catch (error) {
    throw new Error(`Failed to read Excel file: ${error.message}`);
  }
}

async function readFile(filePath, originalName) {
  const fileExtension = originalName.toLowerCase().split('.').pop();
  if (fileExtension === 'csv') {
    return await readCSVFile(filePath);
  } else if (fileExtension === 'xls' || fileExtension === 'xlsx') {
    return await readExcelFile(filePath);
  } else {
    throw new Error('Unsupported file format. Please upload CSV or Excel files.');
  }
}

function extractItemIdFromFacebookUrl(url) {
  if (!url) return null;
  const match = url.match(/marketplace\/item\/(\d+)/) || url.match(/[?&]item_id=(\d+)/);
  return match ? match[1] : null;
}

async function loginToFacebook(page) {
  try {
    console.log('🔐 Logging into Facebook...');
    
    await page.goto('https://www.facebook.com/login', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    await wait(1500);
    
    await page.waitForSelector('#email', { timeout: 10000 });
    await page.type('#email', FACEBOOK_EMAIL, { delay: 50 });
    
    await page.type('#pass', FACEBOOK_PASSWORD, { delay: 50 });
    
    await Promise.all([
      page.click('button[name="login"]'),
      page.waitForNavigation({ 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      })
    ]);
    
    await wait(2000);
    
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('checkpoint')) {
      console.error('❌ Login failed');
      return false;
    }
    
    console.log('✅ Successfully logged into Facebook');
    
    const cookies = await page.cookies();
    
    if (!fs.existsSync('/tmp')) {
      fs.mkdirSync('/tmp', { recursive: true });
    }
    fs.writeFileSync('/tmp/facebook_cookies.json', JSON.stringify(cookies, null, 2));
    
    return cookies;
    
  } catch (error) {
    console.error('❌ Login error:', error.message);
    return false;
  }
}

async function loadSavedCookies() {
  try {
    if (fs.existsSync('/tmp/facebook_cookies.json')) {
      const cookiesString = fs.readFileSync('/tmp/facebook_cookies.json', 'utf8');
      const cookies = JSON.parse(cookiesString);
      console.log('📂 Loaded saved Facebook cookies');
      return cookies;
    }
  } catch (error) {
    console.log('⚠️ Could not load saved cookies:', error.message);
  }
  return null;
}

async function fetchFacebookListingDetails(facebookUrl, page) {
  try {
    console.log(`🌐 Processing: ${facebookUrl.substring(0, 80)}...`);
    
    await page.goto(facebookUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await wait(5000);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await wait(1000);

    console.log(`🔍 Extracting seller information...`);

    const listingData = await page.evaluate(() => {
      const data = {
        sellerId: null,
        sellerName: null,
        sellerProfileUrl: null,
        listingTitle: null,
        price: null,
        location: null,
        description: null,
        imagesCount: 0,
        category: null,
        condition: null,
        postedDate: null,
        extractionMethods: []
      };

      const scripts = document.querySelectorAll('script[type="application/json"]');
      for (const script of scripts) {
        const text = script.textContent;
        if (!text) continue;
        
        try {
          const jsonMatch = text.match(/"seller_id":"(\d+)"|"sellerId":"(\d+)"|"profile_id":"(\d+)"/);
          if (jsonMatch) {
            data.sellerId = jsonMatch[1] || jsonMatch[2] || jsonMatch[3];
            data.extractionMethods.push('Script JSON');
            break;
          }
        } catch (e) {}
      }

      if (!data.sellerId) {
        const sellerLinks = document.querySelectorAll('a[href*="facebook.com/marketplace/profile"], a[href*="profile.php?id="]');
        for (const link of sellerLinks) {
          const href = link.getAttribute('href');
          const match = href.match(/profile\/(\d+)|id=(\d+)/);
          if (match) {
            data.sellerId = match[1] || match[2];
            data.sellerName = link.textContent?.trim() || link.getAttribute('aria-label');
            data.sellerProfileUrl = href.startsWith('http') ? href : `https://facebook.com${href}`;
            data.extractionMethods.push('Profile link');
            break;
          }
        }
      }

      const titleElement = document.querySelector('h1, [role="heading"]');
      if (titleElement) {
        const text = titleElement.textContent?.trim();
        if (text && text.length > 5) {
          data.listingTitle = text;
        }
      }

      const priceElement = document.querySelector('span:not([class*="hidden"])');
      if (priceElement) {
        const text = priceElement.textContent?.trim();
        if (/^[\$€£¥]\s*[\d,]+/.test(text)) {
          data.price = text;
        }
      }

      data.imagesCount = document.querySelectorAll('img[src*="scontent"]').length;

      return data;
    });

    console.log(`✅ Extraction: ${listingData.sellerId ? 'Found seller' : 'No seller'}`);
    return listingData;

  } catch (error) {
    console.error(`❌ Error:`, error.message);
    return null;
  }
}

module.exports.enrichifyItemIds = async (req, res) => {
  let filePath = null;
  let outputFilePath = null;
  let browser = null;
  let page = null;
  let fileDocument = null; // Track the database document

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Get user ID from request (adjust based on your auth setup)
    const userId = req.user?._id || req.body.userId;

    filePath = req.file.path;
    const originalFileName = req.file.originalname;

    console.log('📁 Processing file:', filePath);

    const records = await readFile(filePath, originalFileName);
    console.log(`📊 Found ${records.length} records to process`);

    if (records.length === 0) {
      return res.status(400).json({ error: 'No records found in the file' });
    }

    // Generate passcode
    const passcode = Math.floor(100000 + Math.random() * 900000).toString();

    // Create initial database entry
    fileDocument = await facebookfilemodel.create({
      file: originalFileName,
      user: userId,
      paid: true,
      passcode: passcode,
      recordCount: '0', // Will update as we process
      recordLength: records.length
    });

    console.log('💾 Created database entry:', fileDocument._id);

    console.log('🚀 Creating browser session...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });

    page = await browser.newPage();
    
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    const savedCookies = await loadSavedCookies();
    if (savedCookies) {
      await page.setCookie(...savedCookies);
      console.log('✅ Using saved cookies');
    } else {
      const loginSuccess = await loginToFacebook(page);
      if (!loginSuccess) {
        throw new Error('Failed to login to Facebook');
      }
    }

    const enrichedData = [];
    let consecutiveFailures = 0;
    let processedCount = 0;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      console.log(`\n🔄 Processing ${i + 1}/${records.length}`);

      const facebookUrl = record.url || record.URL || record.facebook_url || 
                          record.facebookUrl || record.link || record.Link;

      if (!facebookUrl) {
        enrichedData.push({
          ...record,
          enrichment_status: 'failed',
          enrichment_error: 'No Facebook URL found'
        });
        continue;
      }

      const itemId = extractItemIdFromFacebookUrl(facebookUrl);
      if (!itemId) {
        enrichedData.push({
          ...record,
          enrichment_status: 'failed',
          enrichment_error: 'Could not extract item ID'
        });
        continue;
      }

      const listingData = await fetchFacebookListingDetails(facebookUrl, page);

      if (!listingData) {
        consecutiveFailures++;
        enrichedData.push({
          ...record,
          facebook_item_id: itemId,
          enrichment_status: 'failed',
          enrichment_error: 'Failed to fetch listing data'
        });
        
        if (consecutiveFailures >= 3) {
          console.log('⚠️ Multiple failures detected, adding extra delay...');
          await wait(10000);
          consecutiveFailures = 0;
        }
        continue;
      }

      consecutiveFailures = 0;
      processedCount++;

      const enrichedRecord = {
        ...record,
        original_facebook_url: facebookUrl,
        facebook_item_id: itemId,
        facebook_seller_id: listingData.sellerId,
        facebook_listing_title: listingData.listingTitle,
        enrichment_status: listingData.sellerId ? 'success' : 'partial',
        enrichment_error: listingData.sellerId ? null : 'Seller ID not found',
        enriched_at: new Date().toISOString()
      };

      enrichedData.push(enrichedRecord);

      // Update database with progress every 5 records
      if (processedCount % 5 === 0) {
        await facebookfilemodel.findByIdAndUpdate(fileDocument._id, {
          recordCount: processedCount.toString()
        });
        console.log(`💾 Updated database: ${processedCount}/${records.length} processed`);
      }

      const delay = 3000 + Math.random() * 2000;
      console.log(`⏳ Waiting ${Math.round(delay/1000)}s...`);
      await wait(delay);
    }

    if (browser) {
      await browser.close();
    }

    // Save results to file
    const outputFileName = `enriched-facebook-${Date.now()}.csv`;
    outputFilePath = `/tmp/public/files/uploads/${outputFileName}`;

    if (!fs.existsSync('/tmp/public/files/uploads')) {
      fs.mkdirSync('/tmp/public/files/uploads', { recursive: true });
    }

    const headers = [...new Set(enrichedData.flatMap(obj => Object.keys(obj)))].map(key => ({
      id: key,
      title: key
    }));

    const csvWriter = createObjectCsvWriter({
      path: outputFilePath,
      header: headers
    });

    await csvWriter.writeRecords(enrichedData);

    const successCount = enrichedData.filter(r => r.enrichment_status === 'success').length;
    const partialCount = enrichedData.filter(r => r.enrichment_status === 'partial').length;
    const failedCount = enrichedData.filter(r => r.enrichment_status === 'failed').length;

    console.log('\n📤 Uploading to Cloudinary...');
    
    const cloudinaryResult = await cloudinaryUpload(outputFilePath);
    
    if (cloudinaryResult.url) {
      console.log('✅ Uploaded to Cloudinary:', cloudinaryResult.url);
    } else {
      console.error('❌ Cloudinary upload failed:', cloudinaryResult);
    }

    // Final database update with output file
    await facebookfilemodel.findByIdAndUpdate(fileDocument._id, {
      output: cloudinaryResult.url || outputFilePath,
      recordCount: processedCount.toString()
    });

    console.log('💾 Final database update completed');

    // Clean up local files
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    if (outputFilePath && fs.existsSync(outputFilePath)) {
      fs.unlinkSync(outputFilePath);
    }

    console.log('\n✅ Enrichment completed!');
    console.log(`Total: ${records.length} | Success: ${successCount} | Partial: ${partialCount} | Failed: ${failedCount}`);

    return res.status(200).json({
      message: 'Enrichment completed',
      data: {
        documentId: fileDocument._id,
        totalRecords: records.length,
        successfulEnrichments: successCount,
        partialEnrichments: partialCount,
        failedEnrichments: failedCount,
        passcode: passcode,
        outputFile: cloudinaryResult.url || outputFilePath,
        cloudinaryUrl: cloudinaryResult.url
      }
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    
    // Update database with error status if document was created
    if (fileDocument) {
      await facebookfilemodel.findByIdAndUpdate(fileDocument._id, {
        recordCount: 'Error occurred'
      }).catch(err => console.error('Failed to update error status:', err));
    }
    
    if (browser) {
      await browser.close();
    }

    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    if (outputFilePath && fs.existsSync(outputFilePath)) {
      fs.unlinkSync(outputFilePath);
    }

    return res.status(400).json({
      error: 'Enrichment failed',
      details: error.message
    });
  }
};