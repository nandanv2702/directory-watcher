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

log('The application has started');

let authToken;

/**
 * Watches the token for expiry and uses time delay (seconds) from {@link decodedToken} to set a timeout.
 * @param {Number} timeToExpiry - time in seconds
 */
const watchToken = (timeToExpiry) => {
    log(`TIME TO EXPIRE IS ${timeToExpiry}`)
    setTimeout(getToken, timeToExpiry * 1000)
}

/**
 * Extracts token expiry, converts to milliseconds, sets time to expiry 
 * to 29 minutes before token expires. Calls {@link watchToken} with time to expiry.
 * @param {String} authToken
 */
const decodeToken = (authToken) => {
    const decodedToken = decode(authToken)
    let expTime = decodedToken.exp * 1000 // in ms
    log(`EXP TIME IS ${expTime}`)
    let timeToExpiry = ((expTime - Date.now()) / 1000) - 1740 // get new token 1 hour before current token expires

    log(`DECODED TOKEN IS ${decodedToken}`)

    watchToken(timeToExpiry)
}


/**
 * Makes a login request to PREP API with credentials in the credentials.js file. Once access token is received, decodeToken is called
 * @returns Promise
 */
async function getToken() {
    return new Promise((resolve, reject) => {
        axios.post(API_URL + '/login', credentials)
            .then(res => {
                authToken = res.data.accessToken
                log(res)
                decodeToken(authToken)
                resolve()
            })
            .catch(err => {
                console.error(err.message)
                // TODO: retry on error
                // TODO: alert on 5xx error
                reject()
            })
    })

}

/**
 * Initializes Chokidar and watches the 'add', 'change', and 'unlink' events. When a file is added,
 * the {@link readFile} function is called asynchronously. Once received, it sends the data to the aos-entries route of the 
 * PREP API.
 */
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
            // TOOD: add retries on 5xx errors and recall getToken on 4xx errors
            // TODO: error handling if fileContents are unable to be
            axios
                .post(API_URL + '/aos-entries', { data: fileContents })
                .then(res => {
                    log(res.status)
                    // fs.unlink(filePath)
                })
                .catch(err => {
                    log(err)
                })


        }) //Adding call for fileChange here and path will be passed in
        .on('change', path => log(`File ${path} has been changed`))
        .on('unlink', path => log(`File ${path} has been removed`));

}

/**
 * Reads a file with the provided file path `filePath`
 * @async
 * @param {String} filePath 
 * @returns Promise
 */
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

/**
 * Application starts here. Get token, then execute everything else (token is required by API for all calls - requires admin privileges)
 */
getToken()
    .then(() => {
        axios.defaults.headers.common['X-ACCESS-TOKEN'] = authToken
        initializeWatcher()
    })