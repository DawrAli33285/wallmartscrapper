const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name:"dbjwbveqn",
  api_key: "774241215571685",
  api_secret: "ysIyik3gF03KPDecu-lOHtBYLf8"
});


module.exports.cloudinaryUpload=async(filetoUpload)=>{
  try{
    console.log(filetoUpload)
   const data=await cloudinary.uploader.upload(filetoUpload,{
       resource_type:'auto'
   })
   
    return {
      url:data.secure_url
    }
}catch(e){
return e
}
}
