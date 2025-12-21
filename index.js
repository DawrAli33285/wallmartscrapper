const express=require('express')
const app=express();
const cors=require('cors')
const authRoutes=require('./routes/user/auth')
const connect=require('./connection')
const fileRoutes=require('./routes/user/file')
require('dotenv').config();

app.use(cors())
app.use(express.json())
connect
app.use(authRoutes)
app.use(fileRoutes)


app.listen(5000,()=>{
    console.log('Listening to port 5000')
})