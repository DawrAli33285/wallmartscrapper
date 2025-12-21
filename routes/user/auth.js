const router=require('express').Router();
const {userLogin,userRegister,resetPassword}=require('../../controller/user/auth')

router.post('/login',userLogin)
router.post('/register',userRegister)
router.post('/reset',resetPassword)

module.exports=router;