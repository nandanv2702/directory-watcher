# PRep Directory Watcher

Watches the `dirPath` directory for changes using [Chokidar](https://github.com/paulmillr/chokidar), parses AOS csv files with [fast-csv](https://www.npmjs.com/package/fast-csv), pushes each file's results to PREP app [API](https://github.com/nandanv2702/aos-dashboard/tree/master/server)

During startup, we make a login request to the API with admin `credentials` in the form
```js
{
  "username": "YOUR_USERNAME",
  "password": "YOUR_PASSWORD"
}
```

Once we get an `accessToken`, we add it to the `X-ACCESS-TOKEN` header in `axios`. We then watch the token and renew it 30 mins before token expiry. The token is used for every request since the API requires authentication with admin credentials for this purpose.

Used in conjunction with the [PRep AOS Dashboard](https://github.com/nandanv2702/aos-dashboard) although the functions are quite modular and can be re-used anywhere.
