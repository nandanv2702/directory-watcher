import { config } from 'dotenv'
config()
import { watch } from 'chokidar';
import { readFileSync, unlink, promises, stat, createReadStream } from 'fs';
import { parse } from 'fast-csv';
import Path from 'path';
import { Agent } from 'https';
import axios from 'axios';
import decode from 'jwt-decode';
import credentials from './credentials.js';
import path from 'path';
import retry from 'async-retry';

const RETRIES = 5; // for all file read events
const WAIT_DURATION = 1000; // how many ms to wait before reading again

const AOS_DIR_PATH = process.env.AOS_DIR_PATH
const SAP_DIR_PATH = process.env.SAP_DIR_PATH
const API_URL = process.env.API_URL
// const API_URL = 'https://localhost:3001/api/v1'
// const AOS_DIR_PATH = "C:\Users\venkatn1\Desktop\Test AOS Files"

const watcherOptions = {
    //'W:\.'
    usePolling: true,
    //ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    awaitWriteFinish: {
        pollInterval: 100,
        stabilityThreshold: 300,
    }
}

const log = console.log.bind(console);

const CACert = readFileSync('./ca-bundle.cer')

const httpsAgent = new Agent({ ca: CACert });
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
                // log(res)
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
 * the {@link readCSV} function is called asynchronously. Once received, it POSTs data to the aos-entries route of the 
 * PREP API.
 */
const initializeAOSWatcher = () => {
    console.log(AOS_DIR_PATH);
    // Initialize watcher.
    const watcher = watch(AOS_DIR_PATH, watcherOptions);

    // Add event listeners.
    watcher
        .on('add', async (filePath) => {
            log(`${filePath} was added`);
            try {
                const fileContents = await readCSV(filePath)


                // send data from files to APIf
                // TOOD: add retries on 5xx errors and recall getToken on 4xx errors
                // TODO: error handling if fileContents are unable to be
                axios
                    .post(API_URL + '/aos-entries', { data: await fileContents })
                    .then(res => {
                        log(res.status)
                        unlink(filePath, (err) => {
                            if (err) {
                                console.error(err);
                            }
                        })
                    })
                    .catch(err => {
                        console.error(err.message)
                    })
            } catch (err) {
                console.error(`Error reading ${filePath}. Retried ${RETRIES} times.`)
                console.error(err);
            }

        }) //Adding call for fileChange here and path will be passed in
        .on('change', path => log(`File ${path} has been changed`))
        .on('unlink', path => log(`File ${path} has been removed`));

}

/**
 * Returns bikes that have been most recently operated on at every station
 * @param {JSON} fileContents - a parsed .json file
 * @returns Array<Object>
 */
function getRecentBikes(fileContents) {
    const rows = fileContents.Rowsets.Rowset.Row;

    // extract all with LAST_OPERATION !== '---'
    const hasLastOperation = rows.filter((row) => row.LAST_OPERATION !== '---');

    const sortByOperation = {};

    // group by station (LAST_OPERATION)
    hasLastOperation.forEach((operation) => {
        const lastOperation = operation.LAST_OPERATION;
        if (!Object.keys(sortByOperation).includes(lastOperation)) {
            sortByOperation[lastOperation] = [operation];
        } else {
            sortByOperation[lastOperation].push(operation);
        }
    });

    const recentBikes = [];

    // filter for subassemblies
    // sort by most recent (SEQ_DATE)
    Object.keys(sortByOperation).forEach((operation) => {
        const recentBike = sortByOperation[operation]
            .filter((e) => e.SFC.split('_').length > 1)
            .sort((a, b) => new Date(b.LAST_OPERATION_DATE_TIME) - new Date(a.LAST_OPERATION_DATE_TIME))[0];

        if (recentBike) {
            recentBikes.push(recentBike);
        }
    });
    return recentBikes;
}

function getHighBikes(fileContents) {
    const rows = fileContents.Rowsets.Rowset.Row;

    // highest bike number by date
    const sortByDate = {};

    rows.forEach((row) => {
        const date = row.SEQ_DATE.split('T')[0]
        if (!(Object.keys(sortByDate).includes(date))) {
            sortByDate[date] = [row.SEQ_NUM]
        } else {
            sortByDate[date].push(row.SEQ_NUM)
        }
    })

    Object.keys(sortByDate).forEach((date) => {
        sortByDate[date] = sortByDate[date].sort((a, b) => b - a)[0]
    })

    return sortByDate
}

/**
 * Initializes Chokidar and watches the 'add', 'change', and 'unlink' events. When a file is added,
 * the {@link getRecentBikes} function is called asynchronously. Once received, it POSTs data to the XXXX route of the 
 * PREP API.
 */
const initializeSAPWatcher = () => {
    const watcher = watch(SAP_DIR_PATH, {
        ...watcherOptions, awaitWriteFinish: {
            pollInterval: 100,
            stabilityThreshold: 3500
        }
    });


    // Add event listeners.
    watcher
        .on('add', async (path) => {
            if (path.slice(-4).toLowerCase() === 'json') {
                console.log(path);
                const lineName = path.slice(-10).split('.')[0]

                // TODO: Wrap in while counter for retries during error
                const rawFile = await promises.readFile(path)
                console.log(rawFile)
                console.log(typeof rawFile)
                const fileContents = JSON.parse(rawFile);

                const recentBikes = getRecentBikes(fileContents);

                const highBikes = getHighBikes(fileContents);

                let timeDifference = 0

                stat(path, (err, stats) => {
                    if (err) {
                        console.log(err.message);
                    } else {
                        timeDifference = Date.now() - stats.mtimeMs
                        console.log(`timediff is ${timeDifference}`)

                        if (timeDifference > 120000) {
                            // POST recentBikes to API
                            sendData(recentBikes, highBikes, lineName, timeDifference);
                        } else {
                            sendData(recentBikes, highBikes, lineName);
                        }
                    }
                })

            }

        })
        .on('change', async (path) => {
            if (path.slice(-4).toLowerCase() === 'json') {
                log(`File ${path} has been changed`)

                const lineName = path.slice(-10).split('.')[0]

                // TODO: Wrap in while counter for retries during error
                const rawFile = await promises.readFile(path)
                const fileContents = JSON.parse(rawFile);

                const recentBikes = getRecentBikes(fileContents);

                const highBikes = getHighBikes(fileContents);

                sendData(recentBikes, highBikes, lineName);
            }

        })
        .on('unlink', path => log(`File ${path} has been removed`));
}

/**
 * Reads a file with the provided file path `filePath`
 * @async
 * @param {String} filePath 
 * @returns Promise
 */
const readCSV = async function (filePath, currentRetries = 0) {
    const fileContents = []

    const headers = ["commodityCode", "makeOrBuy", "partNumber", "issuingSLoc", "receivingSLoc", "huNumber", "plantCode", "currBike", "highBike", "rackNumber", "productionDate"]

    return new Promise((resolve, reject) => {
        createReadStream(filePath)
            .on('error', err => {
                // handles EBUSY / ENOENT errors by retrying after WAIT_DURATION for RETRIES times
                setTimeout(() => {
                    if (currentRetries !== RETRIES) {
                        currentRetries += 1
                        console.log(`retrying ${currentRetries}`);
                        readCSV(filePath, currentRetries)
                    } else {
                        reject(err)
                    }
                }, WAIT_DURATION)
            })
            .pipe(parse({ headers }))
            .on('data', row => {
                fileContents.push(row)
            })
            .on('end', (rowCount) => {
                console.log(`Parsed ${rowCount} rows in ${filePath} \n`)
                resolve(fileContents)
            })
    })
}

/**
 * Application starts here. Get token, then execute everything else (token is required by API for all calls - requires admin privileges)
 */
getToken()
    .then(() => {
        axios.defaults.headers.common['X-ACCESS-TOKEN'] = authToken
        initializeAOSWatcher()
        // initializeSAPWatcher()
    })

async function sendData(recentBikes, highBikes, lineName, timeDifference = undefined) {
    axios.post(API_URL + '/sap-entries', { data: { recentBikes, highBikes, lineName }, timeDifference })
        .then((res) => {
            log(res.data);
        })
        .catch((err) => {
            console.error(err);
        });
}
