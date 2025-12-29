const router=require('express').Router()
const multer=require('multer')
const upload = multer({ dest: '/tmp/public/files/uploads' });
const {enrichifyFile,enrichifyItemIds,getAllFacebookOrders,payForUpload,getAllOrders,payForFaceUpload}=require('../../controller/user/file')
const {middleware}=require('../../util/middleware')

router.post('/enrichifyFile',upload.single('file'),middleware,enrichifyFile)
router.post('/create-payment-intent',middleware,payForUpload)
router.post('/create-facebookpayment-intent',middleware,payForFaceUpload)

router.get("/getAllOrders",middleware,getAllOrders)
router.get('/getAllFacebookOrders',middleware,getAllFacebookOrders)
router.post('/enrichifyItemIds',middleware,upload.single('file'),enrichifyItemIds)
module.exports=router;