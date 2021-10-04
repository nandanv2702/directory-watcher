require('dotenv').config()
const chokidar = require('chokidar');
const fs = require('fs');
const fastCSV = require('fast-csv');
const Path = require('path');
const https = require('https');
const axios = require('axios').default;
const decode = require('jwt-decode');
const credentials = require('./credentials');
const path = require('path');

const dirPath = process.env.DIRPATH
const API_URL = process.env.API_URL
// const dirPath = "C:\Users\venkatn1\Desktop\Test AOS Files"

const log = console.log.bind(console);

const CACert = fs.readFileSync('./rootCACert.pem')

const httpsAgent = new https.Agent({ ca: CACert });
axios.defaults.httpsAgent = httpsAgent

// Log the start
log('The application has started');

let authToken;

// get new token before expiry
const watchToken = (timeToExpiry) => {
    log(`TIME TO EXPIRE IS ${timeToExpiry}`)
    setTimeout(getToken, timeToExpiry * 1000)
}

// check the token
const checkToken = (authToken) => {
    const decodedToken = decode(authToken)
    let expTime = decodedToken.exp * 1000 // in ms
    log(`EXP TIME IS ${expTime}`)
    let timeToExpiry = ((expTime - Date.now()) / 1000) - 1740 // get new token 1 hour before current token expires

    log(`DECODED TOKEN IS ${decodedToken}`)

    watchToken(timeToExpiry)
}

// get a new token, set token to new value
async function getToken() {
    return new Promise((resolve, reject) => {
        axios.post(API_URL + '/login', credentials)
            .then(res => {
                authToken = res.data.accessToken
                log(res)
                checkToken(authToken)
                resolve()
            })
            .catch(err => {
                console.error(err.message)
            })
    })

}

const initializeWatcher = () => {
    // Initialize watcher.
    const watcher = chokidar.watch(dirPath, {
        //'W:\.'
        usePolling: true,
        //ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        awaitWriteFinish: {
            pollInterval: 100,
            stabilityThreshold: 1000,
        }
    });


    // Add event listeners.
    watcher
        .on('add', async (filePath) => {
            const fileContents = await readFile(filePath)

            // send data from files to API
            axios
                .post('http://localhost:3001/api/v1/aos-entries', { data: fileContents })
                .then(res => {
                    log(res.status)
                })
                .catch(err => {
                    log(err)
                })

            // fs.unlink(filePath)

        }) //Adding call for fileChange here and path will be passed in
        .on('change', path => log(`File ${path} has been changed`))
        .on('unlink', path => log(`File ${path} has been removed`));

}

const readFile = async function (filePath) {
    const fileContents = []

    const headers = ["commodityCode", "makeOrBuy", "partNumber", "issuingSLoc", "receivingSLoc", "huNumber", "plantCode", "currBike", "highBike", "rackNumber", "productionDate"]

    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(fastCSV.parse({ headers }))
            .on('error', error => console.error(error))
            .on('data', row => {
                fileContents.push(row)
            })
            .on('end', (rowCount) => {
                console.log(`Parsed ${rowCount} rows in ${filePath} \n`)
                resolve(fileContents)
            });
    })
}

getToken()
    .then(() => {
        axios.defaults.headers.common['X-ACCESS-TOKEN'] = authToken
        initializeWatcher()
    })