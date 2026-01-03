const { cloudinaryUpload } = require('../../util/cloudinary');
const fileModel = require('../../models/file');
const axios = require('axios');
const fs = require('fs');
const csv = require('csv-parser');
const os=require('os')
const path=require('path')
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

      console.log("PAYMENT INETENT")
      console.log(paymentIntent)
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
      console.log("UPDATED")
      
  
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



  module.exports.getAllFacebookOrders = async (req, res) => {
    try {
      const allFiles = await facebookfilemodel
        .find({ user: req.user._id })
        .sort({ createdAt: -1 }); // latest first
  
      return res.status(200).json({
        allFiles
      });
    } catch (e) {
      console.log(e.message);
      return res.status(400).json({
        error: "Error while trying to fetch orders for user"
      });
    }
  };
  



//newnew

const FACEBOOK_EMAIL = 'dawar4725@gmail.com'; 
const FACEBOOK_PASSWORD = 'dawaralibukhari';


const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==================== UTILITY FUNCTIONS ====================
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
// ==================== BROWSER MANAGEMENT ====================
async function checkSystemRequirements() {
  console.log('🔍 Checking system requirements...');
  
  const nodeVersion = process.version;
  console.log(`Node.js version: ${nodeVersion}`);
  
  const totalMem = os.totalmem() / (1024 * 1024 * 1024);
  const freeMem = os.freemem() / (1024 * 1024 * 1024);
  console.log(`Memory: ${totalMem.toFixed(2)}GB total, ${freeMem.toFixed(2)}GB free`);
  
  console.log(`Platform: ${process.platform}, Arch: ${process.arch}`);
  
  if (freeMem < 1) {
    console.warn('⚠️ Low memory available. Consider closing other applications.');
  }
  
  return freeMem;
}

function getChromePath() {
  const isWindows = process.platform === 'win32';
  
  let possiblePaths = [];
  
  if (isWindows) {
    // Windows paths
    possiblePaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
  } else {
    // Linux/Mac paths
    possiblePaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/usr/bin/google-chrome',        
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ];
  }

  for (const path of possiblePaths) {
    if (!path) continue; // Skip undefined env vars
    
    try {
      if (fs.existsSync(path)) {
        console.log(`✅ Found Chrome at: ${path}`);
        return path;
      }
    } catch (e) {
      continue;
    }
  }

  console.warn('⚠️ Chrome not found in common locations');
  console.warn('💡 Install Chrome from: https://www.google.com/chrome/');
  return null;
}



async function createBrowser() {
  const puppeteer = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  
  // Add stealth plugin to avoid detection
  puppeteer.use(StealthPlugin());

  await checkSystemRequirements();
  const chromePath = getChromePath();
  
  // If no Chrome found, try without executablePath (Puppeteer will download Chromium)
  if (!chromePath) {
    console.log('⚠️ Chrome not found, using Puppeteer bundled Chromium...');
    console.log('💡 This will download Chromium automatically on first run');
  }

  // Single optimized config - headless for maximum speed
// Stealth mode config to avoid Facebook detection
const config = {
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--window-size=1920,1080',
    '--start-maximized',
    '--disable-web-security',
    '--disable-features=VizDisplayCompositor'
  ],
  defaultViewport: { width: 1920, height: 1080 },
  ignoreDefaultArgs: ['--enable-automation'],
  timeout: 30000
};
  // Only add executablePath if Chrome was found
  if (chromePath) {
    config.executablePath = chromePath;
  }

  try {
    console.log('🚀 Launching browser in optimized headless mode...');
    const browser = await puppeteer.launch(config);
    console.log('✅ Browser launched successfully');
    
    browser.on('disconnected', () => {
      console.log('⚠️ Browser disconnected');
    });
    
    return browser;
  } catch (error) {
    console.error('❌ Browser launch failed:', error.message);
    
    // Provide helpful error message based on platform
    if (process.platform === 'win32') {
      console.error('\n💡 SOLUTION FOR WINDOWS:');
      console.error('1. Install Google Chrome from: https://www.google.com/chrome/');
      console.error('2. Or install Puppeteer with Chromium: npm install puppeteer');
      console.error('3. If you have Chrome installed, set environment variable:');
      console.error('   set PUPPETEER_EXECUTABLE_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    } else {
      console.error('\n💡 SOLUTION FOR LINUX:');
      console.error('Run: sudo apt-get install -y chromium-browser');
    }
    
    throw error;
  }
}

// async function createBrowser() {
//   const puppeteer = require('puppeteer');

//   await checkSystemRequirements();
  
  
//   // Check for Chrome/Chromium installation
//   const chromePath = getChromePath();
//   if (!chromePath) {
//     throw new Error('Chrome/Chromium not found. Please install: sudo apt-get install -y chromium-browser');
//   }

//   const launchConfigs = [
//     // Config 1: Headless with minimal args
//     {
//       executablePath: chromePath,
//       headless: 'new',
//       args: [
//         '--no-sandbox',
//         '--disable-setuid-sandbox',
//         '--disable-dev-shm-usage',
//         '--disable-gpu',
//         '--window-size=1920,1080'
//       ],
//       defaultViewport: null,
//       timeout: 30000
//     },
//     // Config 2: Visible browser
    
//       {
//         executablePath: chromePath,
//         headless: false,
//         args: [
//         '--no-sandbox',
//         '--disable-setuid-sandbox',
//         '--window-size=1920,1080',
//         '--start-maximized'
//       ],
//       defaultViewport: null,
//       timeout: 30000
//     },
//     // Config 3: Even simpler
//     {
//       executablePath: chromePath,
//       headless: false,
//       args: ['--no-sandbox'],
//       defaultViewport: null,
//       timeout: 30000
//     },
//     // Config 4: Try with explicit Chrome path (Windows)
//     {
//       headless: false,
//       executablePath: getChromePath(),
//       args: ['--no-sandbox', '--disable-setuid-sandbox'],
//       defaultViewport: null,
//       timeout: 30000
//     }
//   ];

//   for (let i = 0; i < launchConfigs.length; i++) {
//     try {
//       console.log(`🚀 Trying browser configuration ${i + 1}...`);
//       const browser = await puppeteer.launch(launchConfigs[i]);
      
      
//       console.log(`✅ Successfully launched browser with config ${i + 1}`);
      
//       // Set up browser event listeners
//       browser.on('disconnected', () => {
//         console.log('⚠️ Browser disconnected');
//       });
      
//       browser.on('targetcreated', (target) => {
//         console.log(`🎯 Target created: ${target.url()}`);
//       });
      
//       return browser;
//     } catch (error) {
//       console.error(`❌ Config ${i + 1} failed: ${error.message}`);
//       if (i === launchConfigs.length - 1) {
//         throw new Error(`All browser configurations failed: ${error.message}`);
//       }
//       await wait(3000);
//     }
//   }
// }

// function getChromePath() {
//   const possiblePaths = [
//     '/snap/bin/chromium',            // Snap Chromium (what you have installed)
//     '/usr/bin/google-chrome',        
//     '/usr/bin/google-chrome-stable',
//     '/usr/bin/chromium-browser',
//     '/usr/bin/chromium'
//   ];

//   for (const path of possiblePaths) {
//     try {
//       if (fs.existsSync(path)) {
//         console.log(`✅ Found Chrome at: ${path}`);
//         return path;
//       }
//     } catch (e) {
//       continue;
//     }
//   }

//   console.warn('⚠️ Chrome not found in common locations');
//   return null;
// }

// ==================== FACEBOOK AUTHENTICATION ====================
async function loginToFacebook(page) {
  try {
    console.log('🔐 Logging into Facebook...');
    
    await page.goto('https://www.facebook.com/login', { 
      waitUntil: 'networkidle0',
      timeout: 4500 
    });
    
    await wait(1500);
    
    // Check if already logged in
    const currentUrl = page.url();
    if (!currentUrl.includes('login')) {
      console.log('✅ Already logged in');
      return true;
    }
    
    await page.waitForSelector('#email', { timeout: 10000 });
    
    // Type more human-like with random delays
    await page.click('#email');
    await wait(500 + Math.random() * 500);
    await page.type('#email', FACEBOOK_EMAIL, { delay: 100 + Math.random() * 100 });
    
    await wait(800 + Math.random() * 400);
    await page.click('#pass');
    await wait(300 + Math.random() * 300);
    await page.type('#pass', FACEBOOK_PASSWORD, { delay: 120 + Math.random() * 80 });
    
    await wait(1000 + Math.random() * 500);

    await Promise.all([
      page.click('button[name="login"]'),
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 })
    ]);
    
    await wait(1500);
    
    const loggedInUrl = page.url();
    if (loggedInUrl.includes('checkpoint') || loggedInUrl.includes('login_attempt')) {
      console.error('❌ Login failed - checkpoint required');
      return false;
    }
    
    console.log('✅ Successfully logged into Facebook');
    
    // Save cookies
    const cookies = await page.cookies();
    const tmpDir = path.join(os.tmpdir(), 'facebook_scraper');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    fs.writeFileSync(path.join(tmpDir, 'facebook_cookies.json'), JSON.stringify(cookies, null, 2));
    
    return true;
    
  } catch (error) {
    console.error('❌ Login error:', error.message);
    return false;
  }
}

async function loadSavedCookies(page) {
  try {
    const cookiePath = path.join(os.tmpdir(), 'facebook_scraper', 'facebook_cookies.json');
    if (fs.existsSync(cookiePath)) {
      const cookiesString = fs.readFileSync(cookiePath, 'utf8');
      const cookies = JSON.parse(cookiesString);
      
      if (cookies.length > 0) {
        await page.setCookie(...cookies);
        console.log('📂 Loaded saved Facebook cookies');
        return true;
      }
    }
  } catch (error) {
    console.log('⚠️ Could not load saved cookies:', error.message);
  }
  return false;
}

// ==================== DATA EXTRACTION ====================
async function fetchFacebookListingDetails(facebookUrl, page, retryCount = 0) {
    const maxRetries = 2;
    
    try {
      console.log(`🌐 Processing: ${facebookUrl.substring(0, 80)}...`);
  
      // Navigate to the page
      await page.goto(facebookUrl, { 
        waitUntil: 'networkidle0',
        timeout: 45000
      });
      
      // Check if redirected to login
      const currentUrl = await page.url();
      if (currentUrl.includes('login') || currentUrl.includes('checkpoint')) {
        console.error('❌ Redirected to login/checkpoint page');
        return null;
      }
  
      await wait(1500);
  
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
  
        // ===== METHOD 1: EXTRACT FROM VISIBLE SELLER PROFILE LINK (MOST RELIABLE) =====
        // This should be the PRIMARY method as it's the most accurate
        const sellerLinkSelectors = [
          'a[href*="/marketplace/profile/"]',
          'a[href*="/profile.php?id="]',
          'a[role="link"][href*="facebook.com"]',
          '[data-testid*="seller"] a',
          '[data-testid*="profile"] a'
        ];
        
        for (const selector of sellerLinkSelectors) {
          const links = document.querySelectorAll(selector);
          for (const link of links) {
            const href = link.getAttribute('href');
            if (!href) continue;
            
            // Match seller profile URLs specifically
            const profileMatch = href.match(/\/marketplace\/profile\/(\d+)/);
            const idMatch = href.match(/profile\.php\?id=(\d+)/);
            
            if (profileMatch && profileMatch[1]) {
              data.sellerId = profileMatch[1];
              data.sellerName = link.textContent?.trim() || link.getAttribute('aria-label') || null;
              data.sellerProfileUrl = href.startsWith('http') ? href : `https://facebook.com${href}`;
              data.extractionMethods.push('Profile Link (marketplace/profile)');
              break;
            } else if (idMatch && idMatch[1]) {
              data.sellerId = idMatch[1];
              data.sellerName = link.textContent?.trim() || link.getAttribute('aria-label') || null;
              data.sellerProfileUrl = href.startsWith('http') ? href : `https://facebook.com${href}`;
              data.extractionMethods.push('Profile Link (profile.php)');
              break;
            }
          }
          if (data.sellerId) break;
        }
  
        // ===== METHOD 2: SEARCH JSON SCRIPTS (WITH STRICT VALIDATION) =====
        if (!data.sellerId) {
          const scripts = Array.from(document.querySelectorAll('script[type="application/json"]'));
          
          for (const script of scripts) {
            try {
              const jsonContent = JSON.parse(script.textContent);
              
              // Strict recursive search - only look for specific seller-related keys
              const findSellerInObject = (obj, depth = 0) => {
                if (!obj || typeof obj !== 'object' || depth > 10) return null;
                
                // STRICT KEY WHITELIST - only these exact patterns
                const validSellerKeys = [
                  'seller_id',
                  'sellerId', 
                  'seller',
                  'profile_id',
                  'profileId',
                  'actor_id',
                  'actorId',
                  'owner_id',
                  'ownerId',
                  'user_id',
                  'userId'
                ];
                
                for (const [key, value] of Object.entries(obj)) {
                  const keyLower = key.toLowerCase();
                  
                  // Check if this is a seller object
                  if (keyLower === 'seller' || keyLower === 'actor' || keyLower === 'profile') {
                    if (typeof value === 'object' && value !== null) {
                      // Look for ID within seller object
                      if (value.id && /^\d{8,}$/.test(String(value.id))) {
                        return String(value.id);
                      }
                      if (value.fbid && /^\d{8,}$/.test(String(value.fbid))) {
                        return String(value.fbid);
                      }
                      if (value.profile_id && /^\d{8,}$/.test(String(value.profile_id))) {
                        return String(value.profile_id);
                      }
                    }
                  }
                  
                  // Direct seller ID field match (strict)
                  if (validSellerKeys.includes(keyLower) || validSellerKeys.includes(key)) {
                    if (typeof value === 'string' && /^\d{8,}$/.test(value)) {
                      // Additional validation: seller IDs typically don't start with 000
                      if (!value.startsWith('000')) {
                        return value;
                      }
                    }
                  }
                  
                  // Recursively search nested objects
                  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    const result = findSellerInObject(value, depth + 1);
                    if (result) return result;
                  }
                  
                  // Search arrays
                  if (Array.isArray(value) && depth < 5) {
                    for (const item of value) {
                      if (typeof item === 'object' && item !== null) {
                        const result = findSellerInObject(item, depth + 1);
                        if (result) return result;
                      }
                    }
                  }
                }
                
                return null;
              };
              
              const foundId = findSellerInObject(jsonContent);
              if (foundId) {
                data.sellerId = foundId;
                data.extractionMethods.push('JSON Script Search');
                break;
              }
            } catch (e) {
              continue;
            }
          }
        }
  
        // ===== METHOD 3: DATA ATTRIBUTES =====
        if (!data.sellerId) {
          const dataAttrSelectors = [
            '[data-sellerid]',
            '[data-seller-id]',
            '[data-profileid]',
            '[data-profile-id]',
            '[data-userid]',
            '[data-user-id]'
          ];
          
          for (const selector of dataAttrSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              const attrValue = element.getAttribute(selector.slice(1, -1).toLowerCase());
              if (attrValue && /^\d{8,}$/.test(attrValue) && !attrValue.startsWith('000')) {
                data.sellerId = attrValue;
                data.extractionMethods.push('Data Attribute');
                break;
              }
            }
          }
        }
  
        // ===== METHOD 4: LOOK IN PAGE SOURCE FOR SELLER PROFILE URL =====
        if (!data.sellerId) {
          const bodyHTML = document.body.innerHTML;
          
          // Search for marketplace profile URLs in the HTML
          const profileMatches = bodyHTML.match(/\/marketplace\/profile\/(\d{8,})/g);
          if (profileMatches && profileMatches.length > 0) {
            // Get the most common profile ID (likely the seller)
            const profileIds = profileMatches.map(m => m.match(/\/marketplace\/profile\/(\d+)/)[1]);
            const idCounts = {};
            profileIds.forEach(id => {
              idCounts[id] = (idCounts[id] || 0) + 1;
            });
            
            // Get the ID that appears most frequently
            const mostCommonId = Object.keys(idCounts).reduce((a, b) => 
              idCounts[a] > idCounts[b] ? a : b
            );
            
            if (mostCommonId && idCounts[mostCommonId] >= 2) { // Must appear at least twice
              data.sellerId = mostCommonId;
              data.extractionMethods.push('HTML Source (most common profile ID)');
            }
          }
        }
  
        // ===== EXTRACT OTHER LISTING DETAILS =====
        
        // Title
        const titleSelectors = [
          'h1[dir="auto"]',
          'span.x1lliihq.x6ikm8r.x10wlt62.x1n2onr6',
          '[data-testid*="title"]',
          'h1'
        ];
        
        for (const selector of titleSelectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent) {
            const text = el.textContent.trim();
            if (text.length > 5 && text.length < 300) {
              data.listingTitle = text;
              break;
            }
          }
        }
  
        // Price
        const priceElements = Array.from(document.querySelectorAll('span, div'));
        for (const el of priceElements) {
          const text = el.textContent?.trim();
          if (text && /^[\$€£¥₹]\s*[\d,]+(\.\d{2})?$/.test(text)) {
            data.price = text;
            break;
          }
        }
  
        // Location
        const locationSelectors = [
          '[data-testid*="location"]',
          'div[class*="location"]',
          'span[dir="auto"]'
        ];
        
        for (const selector of locationSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            const text = el.textContent?.trim();
            // Location typically has comma and is under 100 chars
            if (text && text.includes(',') && text.length < 100 && /^[A-Za-z\s,\-]+$/.test(text)) {
              data.location = text;
              break;
            }
          }
        }
  
        // Images count
        data.imagesCount = document.querySelectorAll('img[src*="scontent"], img[src*="fbcdn"], img[alt*="listing"]').length;
  
        // Description (first few hundred characters)
        const descriptionSelectors = [
          '[data-testid*="description"]',
          'div[dir="auto"]',
          'span[dir="auto"]'
        ];
        
        for (const selector of descriptionSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const text = el.textContent?.trim();
            if (text && text.length > 50 && text.length < 5000) {
              data.description = text.substring(0, 500);
              break;
            }
          }
          if (data.description) break;
        }
  
        return data;
      });
  
      console.log(`✅ Extraction: ${listingData.sellerId ? `Seller ID: ${listingData.sellerId}` : 'No seller ID'} | Methods: ${listingData.extractionMethods.join(', ')}`);
      
      // VALIDATION: Warn if seller ID looks suspicious
      if (listingData.sellerId) {
        const sellerId = listingData.sellerId;
        
        // Check if it's the same as the item ID (common mistake)
        const itemId = extractItemIdFromFacebookUrl(facebookUrl);
        if (sellerId === itemId) {
          console.warn(`⚠️ WARNING: Seller ID matches Item ID (${sellerId}). This might be incorrect.`);
          // Don't use it if it matches the item ID
          listingData.sellerId = null;
          listingData.sellerProfileUrl = null;
          listingData.extractionMethods = ['Rejected: matched item ID'];
        }
        
        // Check if it starts with suspicious patterns
        if (sellerId.startsWith('000') || sellerId.startsWith('111')) {
          console.warn(`⚠️ WARNING: Seller ID has suspicious pattern (${sellerId})`);
        }
      }
      
      return listingData;
  
    } catch (error) {
      console.error(`❌ Error fetching ${facebookUrl}:`, error.message);
      
      if (retryCount < maxRetries) {
        console.log(`⚠️ Retrying (${retryCount + 1}/${maxRetries})...`);
        await wait(5000 * (retryCount + 1));
        return await fetchFacebookListingDetails(facebookUrl, page, retryCount + 1);
      }
      
      return null;
    }
  }


// ==================== FILE UPLOAD & DATABASE ====================
async function uploadWithRetry(uploadFunction, filePath, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`📤 Uploading to Cloudinary (attempt ${i + 1}/${maxRetries})...`);
      const result = await uploadFunction(filePath);
      
      if (result && result.url) {
        console.log('✅ Uploaded to Cloudinary:', result.url);
        return result;
      }
    } catch (error) {
      console.error(`❌ Upload attempt ${i + 1} failed:`, error.message);
      if (i < maxRetries - 1) {
        const waitTime = 5000 * (i + 1);
        console.log(`⏳ Waiting ${waitTime/1000}s before retry...`);
        await wait(waitTime);
      }
    }
  }
  
  console.log('⚠️ Cloudinary upload failed, using local file path as fallback');
  return { url: filePath };
}

async function safeDbUpdate(model, id, updateData) {
  try {
    await model.findByIdAndUpdate(id, updateData);
    return true;
  } catch (error) {
    console.error('⚠️ Database update failed (continuing):', error.message);
    return false;
  }
}

// ==================== MAIN FUNCTION ====================
module.exports.enrichifyItemIds = async (req, res) => {
  let filePath = null;
  let outputFilePath = null;
  let browser = null;
  let page = null;
  let fileDocument = null;

  try {
    // Check for uploaded file
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.user?._id || req.body.userId;
    filePath = req.file.path;
    const originalFileName = req.file.originalname;

    console.log('📁 Processing file:', filePath);

    // Read input file
    const records = await readFile(filePath, originalFileName);
    console.log(`📊 Found ${records.length} records to process`);

    if (records.length === 0) {
      return res.status(400).json({ error: 'No records found in the file' });
    }

    // Generate passcode
    const passcode = Math.floor(100000 + Math.random() * 900000).toString();

    // Create database entry (if model is available)
    try {
      // Uncomment and adjust when you have the model
      fileDocument = await facebookfilemodel.create({
        file: originalFileName,
        user: userId,
        paid: false,
        passcode: passcode,
        recordCount: '0',
        recordLength: records.length
      });
      console.log('💾 Created database entry:', fileDocument._id);
      console.log('💾 Would create database entry (model not available)');
    } catch (dbError) {
      console.error('⚠️ Failed to create database entry:', dbError.message);
    }

    // Create browser session
    browser = await createBrowser();
    page = await browser.newPage();
    
    // Configure page
  // Configure page with stealth settings
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });
  
  // Additional stealth measures
  await page.evaluateOnNewDocument(() => {
    // Override the navigator.webdriver property
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });
    
    // Override plugins to appear more like a real browser
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });
    
    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });
    
    // Override chrome property
    window.chrome = {
      runtime: {}
    };
    
    // Override permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
  });
    
    // Block unnecessary resources for faster loading
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      // Only block media and fonts, allow images and stylesheets to appear more natural
      if (['media', 'font'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Handle Facebook authentication
  // Handle Facebook authentication - force fresh login
  console.log('🔐 Starting fresh login (skipping cookies)...');
  const loginSuccess = await loginToFacebook(page);
  if (!loginSuccess) {
    throw new Error('Failed to login to Facebook');
  }

    // Process records
    const enrichedData = [];
    let consecutiveFailures = 0;
    let processedCount = 0;
    let successCount = 0;
    let partialCount = 0;
    let failedCount = 0;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      console.log(`\n🔄 Processing ${i + 1}/${records.length}`);

      // Find Facebook URL in various possible fields
      const facebookUrl = record.url || record.URL || record.facebook_url || 
                          record.facebookUrl || record.link || record.Link;

      if (!facebookUrl) {
        console.log('❌ No Facebook URL found');
        enrichedData.push({
          ...record,
          enrichment_status: 'failed',
          enrichment_error: 'No Facebook URL found'
        });
        failedCount++;
        continue;
      }

      // Extract item ID
      const itemId = extractItemIdFromFacebookUrl(facebookUrl);
      if (!itemId) {
        console.log('❌ Could not extract item ID');
        enrichedData.push({
          ...record,
          enrichment_status: 'failed',
          enrichment_error: 'Could not extract item ID'
        });
        failedCount++;
        continue;
      }

      // Fetch listing details
      const listingData = await fetchFacebookListingDetails(facebookUrl, page);

      if (!listingData) {
        consecutiveFailures++;
        console.log('❌ Failed to fetch listing data');
        
        enrichedData.push({
          ...record,
          facebook_item_id: itemId,
          enrichment_status: 'failed',
          enrichment_error: 'Failed to fetch listing data'
        });
        failedCount++;
        
        // If multiple failures, add extra delay
        if (consecutiveFailures >= 3) {
          console.log('⚠️ Multiple consecutive failures detected, adding extra delay...');
          await wait(15000);
          consecutiveFailures = 0;
        }
        continue;
      }

      consecutiveFailures = 0;
      processedCount++;

      // Determine enrichment status
      let enrichmentStatus = 'partial';
      let enrichmentError = 'Seller ID not found';
      
      if (listingData.sellerId) {
        enrichmentStatus = 'success';
        enrichmentError = null;
        successCount++;
      } else {
        partialCount++;
      }

      // Create enriched record
      const enrichedRecord = {
        ...record,
        original_facebook_url: facebookUrl,
        facebook_item_id: itemId,
        facebook_seller_id: listingData.sellerId,
        facebook_seller_name: listingData.sellerName,
        facebook_seller_profile_url: listingData.sellerProfileUrl,
        facebook_listing_title: listingData.listingTitle,
        facebook_price: listingData.price,
        facebook_location: listingData.location,
        facebook_images_count: listingData.imagesCount,
        extraction_methods: listingData.extractionMethods.join(', '),
        enrichment_status: enrichmentStatus,
        enrichment_error: enrichmentError,
        enriched_at: new Date().toISOString()
      };

      enrichedData.push(enrichedRecord);

      // Update database progress (if model available)
      if (processedCount % 5 === 0 && fileDocument) {
        await safeDbUpdate(facebookfilemodel, fileDocument._id, {
          recordCount: processedCount.toString()
        });
        console.log(`💾 Database progress: ${processedCount}/${records.length} processed`);
      }

      // Adaptive delay between requests
      const baseDelay = 3000;
      const delay = baseDelay + Math.random() * 2000;
      console.log(`⏳ Waiting ${Math.round(delay/1000)}s...`);
      await wait(delay);
      
      // Health check every 10 records
      if (processedCount % 10 === 0 && processedCount > 0) {
        try {
          await page.evaluate(() => {
            if (document.readyState !== 'complete') {
              throw new Error('Page health check failed');
            }
          });
        } catch (e) {
          console.log('⚠️ Page health check failed, reloading...');
          await page.reload({ waitUntil: 'domcontentloaded' });
          await wait(1500);
        }
      }
    }

    // Close browser
    if (browser) {
      await browser.close();
      console.log('✅ Browser closed');
    }

    // Save results to CSV
    const outputFileName = `enriched-facebook-${Date.now()}.csv`;
    const uploadsDir = path.join(os.tmpdir(), 'uploads');
    
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    
    outputFilePath = path.join(uploadsDir, outputFileName);

    // Get all unique headers from enriched data
    const headers = [...new Set(enrichedData.flatMap(obj => Object.keys(obj)))].map(key => ({
      id: key,
      title: key
    }));

    // Write CSV file
    const csvWriter = createObjectCsvWriter({
      path: outputFilePath,
      header: headers
    });

    await csvWriter.writeRecords(enrichedData);
    console.log('✅ CSV file created:', outputFilePath);

    // Calculate statistics
    console.log('\n✅ ========== ENRICHMENT COMPLETED ==========');
    console.log(`Total Records: ${records.length}`);
    console.log(`Success: ${successCount} | Partial: ${partialCount} | Failed: ${failedCount}`);
    console.log(`Success Rate: ${((successCount/records.length)*100).toFixed(1)}%`);
    console.log('============================================\n');

    // Prepare response
    const previewRecords = enrichedData.slice(0, 3);
    const responseData = {
      message: 'Enrichment completed successfully',
      data: {
        documentId: fileDocument?._id || 'N/A',
        totalRecords: records.length,
        successfulEnrichments: successCount,
        partialEnrichments: partialCount,
        failedEnrichments: failedCount,
        successRate: `${((successCount/records.length)*100).toFixed(1)}%`,
        passcode: passcode,
        outputFile: outputFilePath,
        previewData:previewRecords,
        summary: {
          total: records.length,
          success: successCount,
          partial: partialCount,
          failed: failedCount
        }
      }
    };

    // If Cloudinary is available, upload the file
    if (typeof cloudinaryUpload !== 'undefined') {
      try {
        const cloudinaryResult = await uploadWithRetry(cloudinaryUpload, outputFilePath);
        responseData.data.cloudinaryUrl = cloudinaryResult.url;
        responseData.data.outputFile = cloudinaryResult.url;
        
        // Update database with Cloudinary URL if document exists
        if (fileDocument) {
          await safeDbUpdate(facebookfilemodel, fileDocument._id, {
            output: cloudinaryResult.url,
            recordCount: processedCount.toString()
          });
        }
      } catch (uploadError) {
        console.error('⚠️ Cloudinary upload failed:', uploadError.message);
      }
    }

    // Clean up local files
    const cleanupFiles = async (file) => {
      if (file && fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
          console.log(`🗑️ Cleaned up file: ${file}`);
        } catch (e) {
          console.error(`Failed to delete file ${file}:`, e.message);
        }
      }
    };

    await cleanupFiles(filePath);
    
    // Only delete output file if we successfully uploaded to Cloudinary
    if (responseData.data.cloudinaryUrl && responseData.data.cloudinaryUrl !== outputFilePath) {
      await cleanupFiles(outputFilePath);
    }
    

    return res.json(responseData);
  } catch (error) {
    console.error('❌ CRITICAL ERROR:', error.message);
    console.error(error.stack);
    
    // Update database with error status
    if (fileDocument) {
      try {
        await safeDbUpdate(facebookfilemodel, fileDocument._id, {
          recordCount: 'Error occurred',
          error: error.message.substring(0, 500)
        });
      } catch (updateError) {
        console.error('⚠️ Failed to update database:', updateError.message);
      }
    }
    
    // Clean up resources
    if (page) {
      try {
        await page.close();
      } catch (e) {
        console.error('Failed to close page:', e.message);
      }
    }
    
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('Failed to close browser:', e.message);
      }
    }

    // Clean up files
    const cleanupFiles = async (file) => {
      if (file && fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
          console.log(`🗑️ Cleaned up file: ${file}`);
        } catch (e) {
          console.error(`Failed to delete file ${file}:`, e.message);
        }
      }
    };

    await cleanupFiles(filePath);
    await cleanupFiles(outputFilePath);

    return res.status(500).json({
      error: 'Enrichment failed',
      details: error.message,
      suggestion: 'Check your internet connection and try again with fewer records'
    });
  }
};