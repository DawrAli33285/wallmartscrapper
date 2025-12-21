const router=require('express').Router()
const multer=require('multer')
const upload = multer({ dest: '/tmp/public/files/uploads' });
const {enrichifyFile,payForUpload,getAllOrders}=require('../../controller/user/file')
const {middleware}=require('../../util/middleware')

router.post('/enrichifyFile',upload.single('file'),middleware,enrichifyFile)
router.post('/create-payment-intent',middleware,payForUpload)
router.get("/getAllOrders",middleware,getAllOrders)
module.exports=router;