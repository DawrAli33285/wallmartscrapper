
const userModel=require('../../models/user')
const jwt=require('jsonwebtoken')



module.exports.userLogin=async(req,res)=>{
    let {...data}=req.body;
try{
let userFound=await userModel.findOne({email:data.email})
if(!userFound){
return res.status(400).json({
    error:"user not found"
})
}
let password=await userModel.findOne({email:data.email,password:data.password})
if(!password){
    return res.status(400).json({
        error:"Invalid password"
    })
}

userFound=userFound.toObject();
let token=await jwt.sign(userFound,process.env.JWT_KEY)

return res.status(200).json({
    user:userFound,
    token
})

}catch(e){
    console.log(e.message)
    return res.status(400).json({
        error:"Error occured while trying to login"
    })
}
}




module.exports.userRegister=async(req,res)=>{
    let {...data}=req.body;
try{
let alreadyExists=await userModel.findOne({email:data.email})
if(alreadyExists){
    return res.status(400).json({
        error:"user already exists"
    })
}
let user=await userModel.create(data)
user=user.toObject()
let token=await jwt.sign(user,process.env.JWT_KEY)

return res.status(200).json({
    user,
    token
})

}catch(e){
    console.log(e.message)
    return res.status(400).json({
        error:"Error occured while trying to register"
    })
}
}



module.exports.resetPassword=async(req,res)=>{
    let {...data}=req.body;
try{

    let userFound=await userModel.findOne({email:data.email})
    if(!userFound){
        return res.status(400).json({
            error:"user not found"
        })
    }
    await userModel.updateOne({email:data.email},{
        $set:{
            password:data.password
        }
    })
return res.status(200).json({
    message:"Password reset sucessfully"
})

}catch(e){
    console.log(e.message)
    return res.status(400).json({
        error:"Error occured while trying to reset password"
    })
}
}

