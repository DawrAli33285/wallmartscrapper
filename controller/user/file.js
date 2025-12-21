const { cloudinaryUpload } = require('../../util/cloudinary');
const fileModel = require('../../models/file');
const axios = require('axios');
const fs = require('fs');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');
const XLSX = require('xlsx');

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
            'x-rapidapi-key': 'efc5651cbcmshe26912fd81c7795p13e7afjsn07f94d690435'
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
            'x-rapidapi-key': 'efc5651cbcmshe26912fd81c7795p13e7afjsn07f94d690435'
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
                product_name: productData.name || '',
                product_price: productData.price || '',
                product_currency: productData.currency || '',
                product_rating: productData.rating || '',
                product_reviews_count: productData.reviewsCount || '',
                product_availability: productData.availability || '',
                product_brand: productData.brand || '',
                product_category: productData.category || '',
                product_description: productData.description || '',
                product_main_image: productData.mainImage || '',
                seller_id: productData.catalogSellerId || '',
                seller_name: sellerData?.sellerName || '',
                seller_rating: sellerData?.rating || '',
                seller_feedback_count: sellerData?.feedbackCount || '',
                seller_positive_feedback_percent: sellerData?.positiveFeedbackPercent || '',
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


  module.exports.getAllOrders=async(req,res)=>{
    try{
        
let allFiles=await fileModel.find({user:req.user._id})

return res.status(200).json({
    allFiles
})
    }catch(e){
        console.log(e.message)
        return res.status(400).json({
            error:"Error while trying to fetch orders for user"
        })
    }
  }