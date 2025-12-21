const mongoose=require('mongoose')

const fileSchema=mongoose.Schema({
file:{
    type:String,
    required:true
},
user:{
    type:mongoose.Schema.ObjectId,
    ref:'user'
},
paid:{
    type:Boolean,
    default:true
},
passcode:{
    type:String,
    required:true
},
output:{
    type:String
},
recordCount:{
    type:String
},
recordLength:{
    type:Number
}

},{timestamps:true})


const filemodel=mongoose.model('file',fileSchema)

module.exports=filemodel;