const jwt=require('jsonwebtoken')

module.exports.middleware=async(req,res,next)=>{
    try{
if(req.headers.authorization){
let token=req.headers.authorization.split(' ')[1]
let user=await jwt.verify(token,process.env.JWT_KEY)
req.user=user
}
next();
    }catch(e){
        return res.status(400).json({
            error:"Invalid token"
        })
    }
}