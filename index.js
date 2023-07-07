require('dotenv').config()

const express = require('express');
const { forEach, conformsTo, size, result } = require('lodash');

var getSubtitles = require('./extracter').getSubtitles;

const axios = require('axios');
const fs = require('fs-extra')
const ytdl = require('ytdl-core');
const path = require('path');
const { log } = require('console');
const { Configuration, OpenAIApi } = require("openai");
const { throws } = require('assert');
const {encode, decode} = require('gpt-3-encoder')




const AA_TOKEN = "acbf9e85716d4d29974759183d98ce90"



const app = express();

app.use(express.json());

app.use('/audio', express.static("audio"));
const AUDIO_URL = "https://karanshah7371-scaling-succotash-px5r9qgpgwcr9xp-3000.preview.app.github.dev/audio"



const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);


app.get('/getURL', async (req, res) => {

  const url = req.body.url;
  const language = req.body.lang;
  const model = "chatgpt"

  vid_id = youtube_url_parser(url)  

  var subt_data =null;
  var isParsingError =false;

  var result=null;
  var error =null;

  try {
    subt_data = await subtitle_parser(vid_id) 
  }
  catch(err) {
     isParsingError =true;  
  }
  
  
  //using youtube subtitles method
  if( subt_data && !isParsingError ){
    
     //Generate Timestamps Text using the basic flow.
      var scripts = []
      var plain_text_subtitle=''
      const max_tokens= 3300;

      //Breaking text into parts if more than 12300 characters or ~3000 tokens
      subt_data.forEach(line=>{
        if(calculateTokens(plain_text_subtitle)>=max_tokens)
        {
          scripts.push(plain_text_subtitle);
          plain_text_subtitle=''
        }
       plain_text_subtitle = plain_text_subtitle + `Timestamp: ${line.start}  Text: ${line.text}\n`
     })
     if(plain_text_subtitle.length>0)
     {
      scripts.push(plain_text_subtitle)
     }

     //Calling the new text preprocessor

     const  {groupedArray,model_to_use} = preprocess_data(scripts,model)
     const  {data:timestamp_data,error:llm_error} = await llm_handler(groupedArray,model_to_use)
     

     if(llm_error){
        console.log(llm_error)
        error =llm_error;
     }
     
     for (const key in timestamp_data) {
      let time =convertSecondsToHMS(Math.round(key))
      result = result +`${time}\t${timestamp_data[key].headline}`+"\n"      
      console.log(`${time}\t${timestamp_data[key].headline}`);
    }
     

  }


  
  //harder method to be used
  else if (isParsingError &&  language ){
    console.log("Going to 2nd path")
      const audio_file_name = await audio_download(vid_id)
      const {type,data} = await make_transcript(`${AUDIO_URL}/${audio_file_name}`,language)
      if(type=="chapters"){
        result = data;
      }
      else if(type=='srt'){
        console.log("SRT")
        var scripts = data
        const  {groupedArray,model_to_use} = preprocess_data(scripts,model)
        const  {data:timestamp_data,error:llm_error} = await llm_handler(groupedArray,model_to_use)
   
        if(llm_error){
           console.log(llm_error)
           error =llm_error
        }
           
        for (const key in timestamp_data) {
         let time =convertSecondsToHMS(Math.round(key))
         result = result +`${time}\t${timestamp_data[key].headline}`+"\n"      
         console.log(`${time}\t${timestamp_data[key].headline}`);
       }
      }
    // error = "Subtitles are not accurate enough or not found."
  }
  
  console.log("data- ", result)
   res.json({data:result,error:error});
});


const port = 3000;

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});


//Youtube Parsing and Scraping

function youtube_url_parser(url){
    var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    var match = url.match(regExp);
    return (match&&match[7].length==11)? match[7] : false;
  }
  
  async function subtitle_parser(video_id){
    const data= await getSubtitles({ videoID: video_id})
    return data;
  }
  

// Language model and logic


async function call_simple_chatgpt(current_transcript,previous_output=null, model='gpt-3.5-turbo',run_count=0)
{
 console.log("Calling model..",model)
 console.log("Running Time..",run_count)
 if(run_count>1){
  return null;
 }
 
 const system_prompt =`Given the provided transcript,read it and carefully break it into chapters following the guidelines below:

 * Use the following template: { "timestamp": {"headline": "headline goes here..."},....}
 * Ensure that the curly braces ("{}") and double quotations ("") are balanced in the JSON result.
 * Only use timestamps from the transcript that correlate to headlines; do not select random timestamps.
 * Divide the transcript into chapters based on important key parts.
 * On a scale of 1 to 10, with 1 representing the fewest number of chapters and 5 representing the most, use 2.
 * Keep the headline concise and include the key concept or idea of the chapter.
 * Double-check your answer for accuracy before providing it.
 * Answer the question directly without any additional introduction.
 * Wrap the JSON inside <doofer>{...}</doofer> tags.
 
 Note: If you are unable to break the transcript into chapters, return <doofer>{}</doofer>.`
 
 var user_prompt=''
 if(previous_output){
  user_prompt = `This is output of preceeding part. Use this as reference.\nPrevious Output: [[[ ${previous_output} ]]].\nTrasncript -[[[ ${current_transcript} ]]]`
 }
 else{
  user_prompt = `Transcript- [[[ ${current_transcript} ]]]`
 }
 
var parsed_object_response=null;


try
 {
  console.log("Data Error")
  const completion = await openai.createChatCompletion({
    model: model,
    messages: [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
  });
  console.log(completion.data)
  console.log(completion.data.choices[0].message.content)
   console.log("Error : ")
    const parsed_response = doofer_parser(completion.data.choices[0].message.content);
    parsed_object_response = JSON.parse(parsed_response);
  }
  catch(err)
  {  
     console.log("ER: ")
      let result = await call_simple_chatgpt(current_transcript,previous_output, model,run_count+1)
      parsed_object_response = result
  }

return parsed_object_response


}

async function call_simple_claude(current_ip,previous_op,run_count=0){
  
  if(run_count>1){
    return null;
   }
   

  var parsed_object_response=null;


  const claude_key = "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"
  var instructions = `Given the provided transcript,read it and carefully break it into chapters following the guidelines below:

  * Use the following template: { "timestamp": {"headline": "headline goes here..."},....}
  * Ensure that the curly braces ("{}") and double quotations ("") are balanced in the JSON result.
  * Only use timestamps from the transcript that correlate to headlines; do not select random timestamps.
  * Divide the transcript into chapters based on important key parts.
  * On a scale of 1 to 10, with 1 representing the fewest number of chapters and 5 representing the most, use 2.
  * Keep the headline concise and include the key concept or idea of the chapter.
  * Double-check your answer for accuracy before providing it.
  * Answer the question directly without any additional introduction.
  * Wrap the JSON inside <doofer>{...}</doofer> tags.
  
  Note: If you are unable to break the transcript into chapters, return <doofer>{}</doofer>. `

  if(previous_op){
    instructions = `This is output of preceeding part. Use this as reference.\nPrevious Output: [[[ ${previous_op} ]]].\nTrasncript -[[[ ${current_ip} ]]]`
   }
   else{
    instructions = `Transcript- [[[ ${current_ip} ]]]`
   }

  const headers = {
    'accept': 'application/json',
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
    'x-api-key': claude_key,
  };
  
  const data = {
    model: 'claude-1.3-100k',
    temperature: 0.5,
    prompt: "\n\nHuman: "+instructions+"\n\nAssistant:",
    max_tokens_to_sample: 2000
  };

  try
  {
  console.log("Claude trial box")
  response = await axios.post('https://api.anthropic.com/v1/complete', data, { headers });
  console.log(response.data.completion)
  const parsed_response = doofer_parser(response.data.completion);
  parsed_object_response = JSON.parse(parsed_response);
  }
  catch(err){
    console.log(err)
    let result = await call_simple_chatgpt(current_transcript,previous_op, model,run_count+1)
    parsed_object_response = result
  }
  return parsed_object_response;
}


function preprocess_data(scripts_array,model="chatgpt")
{ 
  var groupedArray = [];
  var tempText = "";
  var model_to_use ='gpt-3.5-turbo';

    if (model == "chatgpt")
    {


        if(scripts_array.length>4){
          model_to_use = 'gpt-3.5-turbo-16k';
          for (let i = 0; i < scripts_array.length; i++) {
            tempText += scripts_array[i];
            if ((i + 1) % 4 === 0) {
              groupedArray.push(tempText);
              tempText = "";
            }

          }

          if (tempText !== "") {
            groupedArray.push(tempText);
          }
        }
        else if (scripts_array.length<=4)
        {
          groupedArray = scripts_array
        }
    }

    else if(model =="claude")
    {
      model_to_use = 'claude';
      if(scripts_array.length>12){
        for (let i = 0; i < scripts_array.length; i++) {
          tempText += scripts_array[i];
          if ((i + 1) % 12 === 0) {
            groupedArray.push(tempText);
            tempText = "";
          }
        }
        if (tempText !== "") {
          groupedArray.push(tempText);
        }

      }
      else {
        for (let i = 0; i < scripts_array.length; i++) {
          tempText += scripts_array[i];
      }

      groupedArray.push(tempText);
    
    }
   }

  return {groupedArray,model_to_use}
}

async function llm_handler(groupedArray,model_to_use)
{  
  var previous_output = null;
  var final_result = {}
  var error=null;

  if(model_to_use=="claude"){

     try{

      for(let i=0;i<groupedArray.length;i++){

        let response = await call_simple_claude(groupedArray[i],previous_output)
        if(response){
        previous_output = response
        final_result = {...final_result,...response}
        }
        else throw new Error("null result from gpt");
      }
    }
    catch(err){
      error= err
    }

      return {data:final_result,error}
  }

  else {

      try{

      for(let i=0;i<groupedArray.length;i++){
      
        let response = await call_simple_chatgpt(groupedArray[i],previous_output, model_to_use)
        if(response){
        previous_output = response
        final_result = {...final_result,...response}
        }
        else throw new Error("null result from gpt");


      }
    }
    catch(err){
      error= err
    }
      console.log("Final response:\n",final_result,error)
      return {data:final_result,error}
}
}



function doofer_parser(input_string){
  
  const regex = /<doofer>([\s\S]*?[\s\S])<\/doofer>/;
  const match = regex.exec(input_string);

  var extractedString=null;
  if (match && match[1]) {
    extractedString = match[1];
  }

  return extractedString;

}





// async function retrieve_simple_response(attemptsLeft,subtitle_array) {

//   if (attemptsLeft === 0) {
//     return {data:null, error:"error parsing claude"};;
//   }


//   var parsed_object_response = null;

  

//   try{

//   const completionDataString = await call_simple_claude(plain_text_subtitle);
//   const parsed_response = doofer_parser(completionDataString);
//   parsed_object_response = JSON.parse(parsed_response);
  
//   }
//   catch(err){
//   console.log("Error occured: ", err)  
//   }



//   if (parsed_object_response === null) {
//     await new Promise((resolve, reject) => {
//       setTimeout(() => {
//         console.log("Retrying...");
//         resolve();
//       }, 3000);
//     });
//     return await retrieve_simple_response(attemptsLeft - 1, plain_text_subtitle, claude_key);
//   } 
//   else {
//     return {data:parsed_object_response, error:null};
//   }
// }


// Functions for timing correction


function convertSecondsToHMS(value, type = 'seconds') {
  let totalSeconds;

  if (type === 'milliseconds') {
    totalSeconds = Math.floor(value / 1000);
  } else {
    totalSeconds = value;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;

  return formattedTime;
}

//Functions used for advanced transcription

async function audio_download(videoID){
    
  let info = await ytdl.getInfo(videoID);
 
  let audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
  const selectedFormat = audioFormats[0];
  const extension = selectedFormat.container;
  const audioStream = ytdl.downloadFromInfo(info, { format: selectedFormat });
  audioStream.pipe(fs.createWriteStream(`audio/${videoID}.${extension}`));

  return `${videoID}.${extension}`;
}


// await video_download(vid_id)
async function video_download(videoID) {

  let info = await ytdl.getInfo(videoID)
  let format = ytdl.chooseFormat(info.formats, { quality: 'highestvideo' });
  const videoStream = ytdl.downloadFromInfo(info, { format: format });
  videoStream.pipe(fs.createWriteStream(`video/${videoID}.mp4`));
  

}




async function make_transcript(audio_url,language="en_us"){

  var result = null; 

  const transcript_endpoint = "https://api.assemblyai.com/v2/transcript"
  var auto_chapters_val = true;
  // ['en','en_au','en_uk','en_us','es','fr','de','it','pt','nl','hi','ja']

  if(['es','fr','de','it','pt','nl','hi','ja'].includes(language)){
    auto_chapters_val = false;
  }


  // Send response to AssemblyAI

  const data = {
    audio_url: audio_url,
    language_code: language,
    auto_chapters: auto_chapters_val,
    punctuate: true
  }
  const headers={
    "Authorization": AA_TOKEN,
    "Content-Type": "application/json"
    }

  const trigger_response = await axios.post(transcript_endpoint, data, { headers: headers })
  var id = trigger_response.data.id
  const response = await pollTranscriptAPI(`${transcript_endpoint}/${id}`)

 // Work with chapters
  var chapters_detected = false;
  console.log("Response: ",response)

  if(false && auto_chapters_val && response.chapters){
  
  const chapter_object =  response.chapters

   if(chapter_object.length>0)
   { 
    chapters_detected = true
    chapter_object.forEach((chapter) => {
      let gist = chapter.gist ;
      let start_time_ms = chapter.start;
      let time_hh_mm_ss = convertSecondsToHMS(start_time_ms,'milliseconds')

      if(result == null){
        result =`${time_hh_mm_ss}\t${gist}`+"\n"
      }

      else{
        result = result + `${time_hh_mm_ss}\t${gist}` + "\n"
      }
      
    });

   }
   if(result)  
   {
    console.log("Final Tx",result)
    return {type:"chapters",data:result}
  }

  }

  else{
    var srtData = await generateSRT(`${transcript_endpoint}/${id}`)
    let subtitles =[]
    let sub_string =''
    srtData.forEach((object)=>{
      if(calculateTokens(sub_string)>3300){
        subtitles.push(sub_string)
        sub_string=''
      }
      sub_string = sub_string +`Timestamp: ${object.startSeconds}  Text: ${object.text}\n`
    })
   if(calculateTokens(sub_string)>0)
    {
      subtitles.push(sub_string)
    }
    return   {type:"srt",data:subtitles}
  }



}





async function pollTranscriptAPI(url) {
  var apiUrl = url; 
  var result = null;

  const headers={
    "Authorization": AA_TOKEN,
    "Content-Type": "application/json"
    }

  while (true) {
    try {
      const response = await axios.get(apiUrl, { headers: headers });
      
      if (response.data && response.data.status=='completed') {
        result = response.data
        break;
      }
    } catch (error) {
      console.error('Error:', error);
    }
    
    await new Promise(resolve => setTimeout(resolve, 10000)); 
  }
  return result
}


async function generateSRT(url){
  var srt_result = null
  
  const headers={
    "Authorization": AA_TOKEN,
    "Content-Type": "application/json"
    }

   const response = await axios.get(url+`/srt?chars_per_caption=100`, { headers: headers });
   let srt = response.data
   srt_result = convertSrtToArray(srt)
   
   return srt_result
    
}




function convertSrtToArray(srt) {
  const lines = srt.trim().split('\n\n');
  
  return lines.map((line) => {
    const [id, time, text] = line.split('\n');
    const [startTime, endTime] = time.split(' --> ');
    const [startSeconds, endSeconds] = [startTime, endTime].map(parseSrtTimeToSeconds);
    
    return {
      id: id.trim(),
      startTime,
      startSeconds,
      endTime,
      endSeconds,
      text: text.trim()
    };
  });
}

function parseSrtTimeToSeconds(time) {
  const [hhmmss, ms] = time.split(',');
  const [hh, mm, ss] = hhmmss.split(':').map(Number);
  const totalSeconds = hh * 3600 + mm * 60 + ss;
  
  return totalSeconds;
}


function calculateTokens(text) 
{
    const encoded = encode(text)
    return encoded.length

}