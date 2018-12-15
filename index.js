#!/usr/bin/nodejs


// -------------- load packages -------------- //
// INITIALIZATION STUFF

var express = require('express');
var hbs = require('hbs');
var path = require('path');
var fs = require('fs');
var statesFcns = require('./doStatesFcns.js');
var app = express();


// -------------- express initialization -------------- //
// PORT SETUP - NUMBER SPECIFIC TO THIS SYSTEM

app.set('port', process.env.PORT || 8080 );
app.set('view engine', 'hbs');


// -------------- serve static folders -------------- //

app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/imgs', express.static(path.join(__dirname, 'imgs')));

app.use(express.static(path.join(__dirname, 'shared')));


// -------------- global variables -------------- //
// Stored in RAM - RESET upon process resatrt

scoresLoad();

// -------------- stategame variables -------------- //
// Store information about active games

remaining_server = {};
score_server = {};
positions_x = {};
positions_y = {};

//these help eliminate prematurely terminated sessions
session_times = {};
setInterval(sessionCleanup, 1e5);
setInterval(scoresSave, 1e5);


// -------------- helper functions -------------- //
// Mainly called upon initial requests

function countVisitors(req, res, next){
    //increment b/c new user
    visitorCount++;
    
    //for future reference
    console.log("Total visitors: " + visitorCount);
	
	//call the next function
	next();
}


// -------------- states game functions -------------- //
// Handle scoring server-side
// and make the game (mostly) hack-proof

function scoresSave(){
    //https://stackoverflow.com/questions/36856232/write-add-data-in-json-file-using-node-js
    //https://stackoverflow.com/questions/2496710/writing-files-in-node-js
    var obj = {
        winners: winners,
        cheaters: cheaters,
        visitors: visitorCount
    }
    fs.writeFile("scores.json", JSON.stringify(obj), 'utf8', function(err){
        if(err){
            return console.log(err);
        }
    });
}
function scoresLoad(){
    //https://stackoverflow.com/questions/36856232/write-add-data-in-json-file-using-node-js
    fs.readFile('scores.json', 'utf8', function(err, data){
        if(err){
            return console.log(err);
        }
        obj = JSON.parse(data);
        winners = obj.winners;
        cheaters = obj.cheaters;
        visitorCount = obj.visitors;
    });
}
function stateCurrent(idf){
    return remaining_server[idf][remaining_server[idf].length - 1];
}
function sessionRefresh(idf, nonew){
    // Setting nonew to true will throw an exception
    // if the given session does not already exist
    if(nonew && typeof session_times[idf] === 'undefined'){
        throw "Session does not exist";
    }
    session_times[idf] = Date.now();
}
function sessionDelete(idf){
    delete session_times[idf];
    delete remaining_server[idf];
    delete score_server[idf];
    delete positions_x[idf];
    delete positions_y[idf];
}
function sessionCleanup(){
    // Deletes all long deserted sessions
    // https://stackoverflow.com/questions/684672/how-do-i-loop-through-or-enumerate-a-javascript-object
    var now = Date.now();
    for(var idf in session_times){
        if(session_times.hasOwnProperty(idf)){
            if(now - session_times[idf] > 1e6){
                //kill after 1000 seconds (16 min)
    			console.log("Terminated session " + idf + " via cleanup");
    			sessionDelete(idf);
            }
        }
    }
}
function stateCalculateActual(idf, s1, s2){
    // Finds the real distance between states
    // Based on the states' recorded locations
    // s1 and s2 are indices
    
    var dx = positions_x[idf][s2] - positions_x[idf][s1];
    var dy = positions_y[idf][s2] - positions_y[idf][s1];
    return Math.sqrt(dx*dx + dy*dy);
}
// https://stackoverflow.com/questions/6274339/how-can-i-shuffle-an-array
function shuffle(a){
    var j, x, i;
    for (i = a.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1));
        x = a[i];
        a[i] = a[j];
        a[j] = x;
    }
    return a;
}
function updateScoreboard(scoreboard, name, score){
    var pos = 5;
    while(pos > 0 && score > scoreboard[pos-1].score){
        pos--;
    }
    scoreboard.splice(pos, 0, {name: name, score: score});
    return scoreboard.slice(0, 5);
}


// -------------- express 'get' handlers -------------- //
// These 'getters' are what fetch the pages

app.get('/', [countVisitors], function(req, res){
    res.render('statesgame', {numVisitors: visitorCount});
});

app.get('/start', function(req, res){
    var idf = req.query.identifier;
    sessionRefresh(idf, false);
    
    //create variables
    console.log("Created session " + idf);
    remaining_server[idf] = shuffle([...Array(50).keys()]);
    score_server[idf] = 0;
    positions_x[idf] = [];
    positions_y[idf] = [];
    
    res.send(remaining_server[idf]);
});
app.get('/award', function(req, res){
    var idf = req.query.identifier;
    sessionRefresh(idf, true);
    
    //log current state
    var id = remaining_server[idf].pop();
    positions_x[idf][id] = req.query.x;
    positions_y[idf][id] = req.query.y;
    
    //check distances
    var out_neighbors = [];
    var out_scores = [];
    var neighbors = statesFcns.border[id];
    for(var i = 0; i < neighbors.length; i++){
        var neighbor = neighbors[i];
        if(typeof positions_x[idf][neighbor] === "undefined")
            continue;
        var distanceRatio = stateCalculateActual(idf, id, neighbor) / statesFcns.ideal[id][i];
        var points = Math.floor(100 * Math.max(0, 1 - Math.abs(1 - distanceRatio)));
        score_server[idf] += points;
        out_neighbors.push(neighbor);
        out_scores.push(points);
    }
    
    //package and send response
    var response = {
        neighbors: out_neighbors,
        scores: out_scores,
    };
    res.send(response);
});
app.get('/hint1', function(req, res){
    var idf = req.query.identifier;
    sessionRefresh(idf, true);
    
    var id = stateCurrent(idf);
    score_server[idf] -= 50;
    res.send(statesFcns.index_to_long[id]);
});
app.get('/hint2', function(req, res){
    var idf = req.query.identifier;
    sessionRefresh(idf, true);
    
    var id = stateCurrent(idf);
    var neighbors = statesFcns.border[id];
    
    //have to check which ones are placed
    neighbors.forEach(function(element){
        if(typeof positions_x[idf][element] === "undefined")
            return;
        score_server[idf] -= 50;
    });
    res.send(neighbors);
});
app.get('/record', function(req, res){
    var idf = req.query.identifier;
    
    if(typeof score_server[idf] !== 'undefined'){
        //weird ordering b/c this gets called upon page load
        //prevents creation of idf=0 sessions
        sessionRefresh(idf, true);
        //check name length
        if(req.query.name.length > 0 && req.query.name.length < 10){
            cheaters = updateScoreboard(cheaters, req.query.name, req.query.score-score_server[idf]);
            winners = updateScoreboard(winners, req.query.name, score_server[idf]);
            
            //delete session naturally
            console.log("Terminated session " + idf + " naturally with score " + score_server[idf]);
            sessionDelete(idf);
        }
    }
    //package and send response
    var response = {
        winners: winners,
        cheaters: cheaters,
    };
    res.send(response);
});


// -------------- listener -------------- //
// The listener is what keeps node 'alive.'

var listener = app.listen(app.get('port'), function() {
    console.log( 'Express server started on port: ' + listener.address().port);
});