const express = require('express');
const request = require('request');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({connectionString: process.env.DATABASE_URL, ssl: true});

var setupFile;
try{
    setupFile = JSON.parse(fs.readFileSync('setup.json', 'utf8'));
}catch(err){
    // Assume that app.js is being run in the cloud (heroku)
    console.log('setup.json not found, assuming app.js is being run in the cloud');
}

const PORT          = process.env.PORT          || 5000;
const REDIRECT_URI  = process.env.REDIRECT_URI  || setupFile.offline_redirect_uri;
const CLIENT_ID     = process.env.CLIENT_ID     || setupFile.client_id;
const CLIENT_SECRET = process.env.CLIENT_SECRET || setupFile.client_secret;

/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
var generateRandomString = function (length) {
    var text = '';
    var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (var i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
};

var stateKey = 'spotify_auth_state';

var app = express()

app.use(express.static(path.join(__dirname, 'public')))
    .set('views', path.join(__dirname, 'views'))
    .set('view engine', 'ejs')
    .use(cookieParser())

app.get('/db', async (req, res) => {
    try {
        const client = await pool.connect()
        const result = await client.query('SELECT * FROM data_table');
        res.render('pages/db', result);
        client.release();
    } catch (err) {
        console.error(err);
        res.send("Error " + err);
    }
});

app.get('/login', function (req, res) {

    var state = generateRandomString(16);
    res.cookie(stateKey, state);

    //Web App requests authorization
    // var scope = 'user-read-playback-state user-read-private user-top-read user-read-email user-read-birthdate';
    var scope = 'user-modify-playback-state user-read-playback-state user-read-private user-top-read user-read-email user-read-birthdate';
    // var scope = 'user-top-read user-modify-playback-state'
    res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
        response_type: 'code',
         client_id: CLIENT_ID,
         scope: scope,
         redirect_uri: REDIRECT_URI,
         state: state
    }));
});

/**
 * User has granted the app permission to access his/her data, and is redirected to the Web App page
 */
app.get('/callback', async (req, res) => {
    // your application requests refresh and access tokens
    // after checking the state parameter

    var code = req.query.code || null;
    var state = req.query.state || null;
    var storedState = req.cookies ? req.cookies[stateKey] : null;
    
    if (state === null || state !== storedState) {
        res.redirect('/#' +
        querystring.stringify({
            error: 'state_mismatch'
        }));
    } else {
        res.clearCookie(stateKey);
        var authOptions = {
            url: 'https://accounts.spotify.com/api/token',
            form: {
                code: code,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code'
            },
            headers: {
                'Authorization': 'Basic ' + (new Buffer(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'))
            },
            json: true
        };

        request.post(authOptions, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                var access_token = body.access_token,
                refresh_token = body.refresh_token;

                var options = {
                    url: 'https://api.spotify.com/v1/me',
                    headers: { 'Authorization': 'Bearer ' + access_token },
                    json: true
                };

                 // use the access token to access the Spotify Web API
                 request.get(options, async (error, response, body) =>{
                     console.log(body);
                    //TO DO: Implement proper DB integration
                    // try{
                    //   const client = await pool.connect();
                    //   var id = body.id;
                    //   var country = body.country;
                    //   var birthdate = body.birthdate;
                    //   var displayName = body.display_name;
                    //   var email = body.email;
                    //   var href = body.href;
                    //   var product = body.product;
                    //   var type = body.type;
                    //   var uri = body.uri;
                    //   var values = 
                    //   "'" + id          + "', " + 
                    //   "'" + country     + "', " + 
                    //   "'" + birthdate   + "', " + 
                    //   "'" + email       + "', " + 
                    //   "'" + href        + "', " + 
                    //   "'" + product     + "', " + 
                    //   "'" + type        + "', " + 
                    //   "'" + uri         + "'";
                    //   var query = "INSERT INTO data_table (myid, country, birthdate, email, href, product, type, uri) VALUES (" + values + ");";
                    //   console.log(query);
                    //   const result = await client.query(query);
                    //   client.release();
                    // } catch(err){
                    //   console.log(err);
                    // }
                });

                res.redirect('/#' +
                querystring.stringify({
                    access_token: access_token,
                    refresh_token: refresh_token
                }));
            } else {
                res.redirect('/#' +
                querystring.stringify({
                    error: 'invalid_token'
                }));
            }
        });
    }
});

/**
 * User or App requests a new Access Token, using the previously generated Refresh Token
 */
app.get('/refresh_token', function (req, res) {
    var refresh_token = req.query.refresh_token;
    var authOptions = {
        url: 'https://accounts.spotify.com/api/token',
        headers: { 'Authorization': 'Basic ' + (new Buffer(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')) },
        form: {
            grant_type: 'refresh_token',
            refresh_token: refresh_token
        },
        json: true
    };
    
    request.post(authOptions, function (error, response, body) {
        if (!error && response.statusCode === 200) {
            var access_token = body.access_token;
            res.send({
                'access_token': access_token
            });
        }
    });
});

console.log('Listening on ' + PORT);
app.listen(PORT);
