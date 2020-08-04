// Imports the Google Cloud client library
const textToSpeech = require('@google-cloud/text-to-speech');

// Import other required libraries
const fs = require('fs');
const util = require('util');
const lineReader = require('line-reader');
Promise = require('bluebird');
const crypto = require('crypto');
const c = require ("./config.js");
// Creates a client
const client = new textToSpeech.TextToSpeechClient();
// Misc
const sleep = util.promisify(setTimeout);
//
//
console.log(`[args] ${process.argv}\n`);
const lang = process.argv[2];
if (lang == null)
    throw `call script like that: ${process.argv[0]} en`;

setTimeout(start, 1000, lang);
//

var db = {};
var wereAnyDownloads = false;
var langs = {};
//
const map = { };
const hashes = { };
const downloaded = [];
const small = [];

const columns = {
    'id': 0,
    'party': 1,
    'sex': 2,
    'actor': 3,
    'phrase': 4,
    // 'file': 5,
}

function start(lang) {
    parse(lang).then(function(data) {
        doIt(data);
    });
}

async function parse(lang) {
    let data = [];
    const inputFile = `input/${lang}.csv`;
    console.log(`reading... ${inputFile}`);
    //
    const eachLine = Promise.promisify(lineReader.eachLine);
    await eachLine(inputFile, function(line) {
        let split = line.split(c.delimiter);
        if (split[columns.id].trim() == 'id')
            return;
        let j = {
            'id': split[columns.id].trim(),
            'party': validateParty(split[columns.party].trim()),
            'sex': validateSex(split[columns.sex]).trim(),
            'actor': validateActor(split[columns.actor].trim()),
            'phrase': validatePhrase(split[columns.phrase].trim()),
            // 'file': validateFile(split[columns.file].trim()),
        };
        data.push(j);
    });
    return data;
}

function validateParty(party) {
    if (party == null)
        return 'A';
    if (['A', 'B', 'S'].includes(party))
        return party;
    throw `Unknown party ${party}`;
}
function validateSex(sex) {
    if (sex == null)
        return 'F';
    if (['F', 'M', 'SF', 'SM'].includes(sex))
        return sex;
    throw `Unknown sex ${sex}`;
}
function validateActor(actor) {
    return actor;
}
// function validateFile(file) {
//     return file;
// }
function validatePhrase(phrase) {
    return phrase.normalizeDoubleSpaces().withMarkdownValue();
}

function prepareSaveFilename(lang, hash, voice) {
    return `db/${lang}/${hash}_${voice}.mp3`
}

async function doIt(data) {
    console.log(`[begin]\n`);
    //
    console.log(`> 'total items: ${data.length}'`);
    //
    if (!fs.existsSync(`db/${lang}`))
        fs.mkdirSync(`db/${lang}`);
    //
    const dbFile = `db/${lang}.json`;
    console.log(`reading... ${dbFile}`);
    if (fs.existsSync(dbFile))
        db = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
    //
    console.log(`reading... langs.json`);
    langs = JSON.parse(fs.readFileSync(`langs.json`, 'utf-8'));
    //
    try {
        data.forEach(function (item) {
            // console.log(item)
            const phrase = item.phrase.normalizeDoubleSpaces();
            // console.log(`  ${phrase}`);
            if (map[phrase] == null) {
                map[phrase] = {
                    'hash': crypto.createHash('md5')
                        .update(phrase,"utf8").digest('hex'),
                };
            }
            const hash = map[phrase]['hash'];
            if (hashes[hash] == null) {
                hashes[hash] = phrase;
            } else if (hashes[hash] != phrase) {
                throw `The same hash ${hash} for different phrases\n ${hashes[hash]}\n ${phrase}`
            } else {
                hashes[hash] = phrase;
            }
            const sex = item.party == 'S' ? 'SF'
                : (item.sex == null ? 'F' : item.sex);
            const tts = langs[langs.map[lang]][sex];
            if (item.party == 'S') {
                map[phrase][`${sex}`] = tts[0];
            } else {
                if (item.party == null)
                    throw `Party should not be null!`;
                switch (item.party) {
                    case 'A': map[phrase][`${sex}-${item.party}`] = tts[0]; break;
                    case 'B': map[phrase][`${sex}-${item.party}`] = tts[1]; break;
                }
            }
        })
    } finally {
        if (wereAnyDownloads)
            fs.writeFileSync(dbFile, JSON.stringify(db));
    }

    try {
        for ([phrase, voiceMap] of Object.entries(map)) {
            let hash = voiceMap.hash;
            for ([speaker, voice] of Object.entries(voiceMap)) {
                if (speaker == 'hash') continue;
                //
                console.log(`\n ${speaker} > ${voice} > ${phrase}`);
                let file = prepareSaveFilename(lang, hash, voice);
                let stat;
                if (!fs.existsSync(file)) {
                    await download(phrase, voice, file);
					stat = fs.statSync(file);
                    downloaded.push(`${file} - ${phrase} - ${stat.size}`);
                    db[phrase] = hash;
                    console.log(` - downloaded: ${file.substring(file.lastIndexOf('/')+1)}`);
                    console.log(` - size: ${stat.size}`);
                    await sleep(c.delayAfterEachDownload);
                }
                stat = stat || fs.statSync(file);
                if (stat.size < c.smallFileThatLessThan)
                    small.push(`${file} - ${phrase} - ${stat.size}`);
            }
        }
    } finally {
        if (wereAnyDownloads)
            fs.writeFileSync(dbFile, JSON.stringify(db));
    }
    //save mapping
    if (!fs.existsSync(`build`))
        fs.mkdirSync(`build`);
    const index = `build/_index_${lang}.json`;
    fs.writeFileSync(index, JSON.stringify(map));
    console.log(`| ${index}, size: ${fs.statSync(index).size} bytes`)
    //print all downloaded
    if (downloaded.length > 0) {
        console.log(`\n[new] Just downloaded`);
        downloaded.forEach(function (entry) {
            console.log(`  ${entry}`);
        });
    } else {
        console.log(`\n[info] No new downloads`);
    }
    //check small files
    if (small.length > 0) {
        console.log(`\n[warning] Please, review the small files less than ${c.smallFileThatLessThan} bytes:`);
        small.forEach(function (entry) {
            console.log(`  ${entry}`);
        });
    }
    //
    console.log(`\n[done]`);
}
//
async function download(phrase, voice, file) {
    const request = {
        input: {text: phrase},
        audioConfig: {
            audioEncoding: 'MP3',
        },
        // voice: {languageCode: 'en-US', ssmlGender: 'FEMALE', name: 'en-US-Wavenet-F'},
        voice: {name: voice, languageCode: voice.substring(0, 5)},
    };
    // Performs the text-to-speech request
    const [response] = await client.synthesizeSpeech(request);
    // Write the binary audio content to a local file
    const writeFile = util.promisify(fs.writeFile);
    try {
        await writeFile(file, response.audioContent, 'binary');
    } catch (e) {
        fs.unlinkSync(file);
        throw e;
    }
    wereAnyDownloads = true;
    await sleep(100);
}

String.prototype.toRegex = function() {
    return new RegExp(this, 'g');
}
String.prototype.normalizeDoubleSpaces = function() {
    return this.replace(/\s{2,}/g, " ");
}

const markdownLinkRegexp = RegExp("\\[.+?\]\\s*\\([^\\[]+\\)");
String.prototype.withMarkdown = function(str, start, end) {
    while (markdownLinkRegexp.test(str)) {
        let match = str.match(markdownLinkRegexp);
        let item = match[0]
        str = str.replace(item, item.substring(item.lastIndexOf(start)+1, item.lastIndexOf(end)));
    }
    return str;
}
String.prototype.withMarkdownKey = function() {
    return toString().withMarkdown(this, '[', ']');
}
String.prototype.withMarkdownValue = function() {
    return toString().withMarkdown(this, '(', ')');
}