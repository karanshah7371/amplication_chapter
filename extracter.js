const he = require('he');
const axios = require('axios');
const { find } = require('lodash');
const striptags = require('striptags');

async function getSubtitles({
  videoID,
  lang = 'en',
}) {
  const { data } = await axios.get(
    `https://youtube.com/watch?v=${videoID}`
  );
  
  // ensure we have access to captions data
  if (!data.includes('captionTracks'))
    throw new Error(`Could not find captions for video: ${videoID}`);

  const regex = /({"captionTracks":.*isTranslatable":(true|false)}])/;
  const [match] = regex.exec(data);
  const { captionTracks } = JSON.parse(`${match}}`);

  const subtitle =
    find(captionTracks, (track) => track.vssId === `.${lang}`) ||
    find(captionTracks, (track) => track.vssId === `a.${lang}`) ||
    find(captionTracks, (track) => track.vssId && track.vssId.match(`.${lang}`));

   if(subtitle && subtitle.kind  && subtitle.kind =='asr')
   {
    throw new Error(`Auto Generated captions for ${videoID}`);
   }
    
   // * ensure we have found the correct subtitle lang
  if (!subtitle || (subtitle && !subtitle.baseUrl))
    throw new Error(`Could not find ${lang} captions for ${videoID}`);

  const { data: transcript } = await axios.get(subtitle.baseUrl);
  
  const lines = transcript
    .replace('<?xml version="1.0" encoding="utf-8" ?><transcript>', '')
    .replace('</transcript>', '')
    .split('</text>')
    .filter((line) => line && line.trim())
    .map((line) => {
      const startRegex = /start="([\d.]+)"/;
      const durRegex = /dur="([\d.]+)"/;

      const [, start] = startRegex.exec(line);
      const [, dur] = durRegex.exec(line);

      const htmlText = line
        .replace(/<text.+>/, '')
        .replace(/&amp;/gi, '&')
        .replace(/<\/?[^>]+(>|$)/g, '');

      const decodedText = he.decode(htmlText);
      const text = striptags(decodedText);

      return {
        start,
        dur,
        text,
      };
    });

  return lines;
}

module.exports = {
  getSubtitles,
};