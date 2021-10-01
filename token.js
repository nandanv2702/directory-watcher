let authToken;

// Get new JWT if expired
async function checkToken() {
    if (authToken) {
        const decodedToken = decode(authToken)
        let expTime = decodedToken.exp * 1000 // in ms
        let timeToExpiry = ((expTime - Date.now()) / 1000) - 3600 // get new token 1 hour before current token expires

        watchToken(timeToExpiry)
        return authToken
    }
    return getToken()
}

// get a new token, set token to new value
async function getToken() {
    axios.post(API_URL + '/login', credentials)
        .then(data => {
            authToken = data.accessToken
            return authToken
        })
        .catch(err => {
            console.error(err.message)
        })
}

// get new token before expiry
const watchToken = (timeToExpiry) => {
    setTimeout(getToken, timeToExpiry)
}

module.exports = checkToken