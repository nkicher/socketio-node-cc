// this api is hosted remotely here:
// https://tpg.cyclic.app/

const express = require('express');
const socketIO = require('socket.io');
const cors = require('cors');
const PORT = process.env.PORT || 3000;
const INDEX = '/index.html';

const server = express()
  .use(cors({ origin: ['http://localhost:4200', 'https://couchco-ops.com'] }))
  .use((req, res) => res.sendFile(INDEX, { root: __dirname }))
  .listen(PORT, () => console.log(`Listening on ${PORT}`));

const io = socketIO(server, {
  cors: {
    origins: ['http://localhost:4200', 'https://couchco-ops.com']
  }
});

////////////////////////////////////////////////////////////////

let boardSocketids = [];
let clientsConnected = 0;
let oceans = [];


/***************************************************************
 * on client connection
 ***************************************************************/ 
io.on('connection', (socket) => {
  clientsConnected++;
  console.log('Client connected ... total = ' + clientsConnected);
  socket.on('disconnect', () => {
    clientsConnected--;
    console.log('Client disconnected ... total = ' + clientsConnected);
    removeOceanIfSocketIsBoard(socket);
  });

  // coming from board
  socket.on('createOcean', msg =>  processCreateOcean(msg, socket.id, socket) );
  socket.on('oceanUpdate', msg =>  processOceanUpdate(msg) );
  socket.on('roundUpdate', msg =>  processRoundUpdate(msg) );
  socket.on('playerInfo' , msg =>  processPlayerInfo(msg) );

  // coming from client
  socket.on('createPlayer'  , msg => processCreatePlayer(msg, socket.id, socket) );
  socket.on('placeCarrier'  , msg => processPlaceCarrier(msg, socket.id));
  socket.on('removeCarrier' , msg => processRemoveCarrier(msg, socket.id));
  socket.on('commitCarrier' , msg => processCommitCarrier(msg, socket.id));
  socket.on('everyonesReady', msg => processEveryonesReady(msg) );
  socket.on('flightControl' , msg => processFlightControl(msg) );
});


/***************************************************************
* processFlightControl
***************************************************************/ 
function processFlightControl(msg) {
  let oceanIdx = oceans.findIndex( resp => resp.oId == msg.oid );
  let teamIdx = oceans[oceanIdx].tms.findIndex( resp => resp.clr == msg.clr );
  let playerIdx = oceans[oceanIdx].tms[teamIdx].plrs.findIndex(resp => resp.id == msg.pid );

  oceans[oceanIdx].tms[teamIdx].plrs[playerIdx].dirCmd = msg.dirCmd;
  oceans[oceanIdx].tms[teamIdx].plrs[playerIdx].mvmCmd = msg.mvmCmd;

  io.to(msg.bsid).emit('flightControl', oceans[oceanIdx]);
}

/***************************************************************
* processRoundUpdate
***************************************************************/ 
function processRoundUpdate(msg) {
  let oceanIdx = oceans.findIndex( resp => resp.oId == msg.oId );
  oceans[oceanIdx].round = msg.round;
  //let ocean = oceans[oceanIdx];
  // broadcast to all clients in this ocean
  io.sockets.in(msg.oId).emit('roundUpdated', oceans[oceanIdx]);
}

/***************************************************************
* processPlayerInfo
***************************************************************/ 
function processPlayerInfo(msg) {
  io.sockets.in(msg.pSid).emit('newPlayerInfo', msg);
}

/***************************************************************
* processOceanUpdate
***************************************************************/ 
function processOceanUpdate(msg) {
  let oceanIdx = oceans.findIndex( resp => resp.oId == msg.oId );
  oceans[oceanIdx] = msg;
  //let ocean = oceans[oceanIdx];
  // broadcast to all clients in this ocean
  io.sockets.in(msg.oId).emit('oceanUpdated', msg);
}


/***************************************************************
* processEveryonesReady
***************************************************************/ 
function processEveryonesReady(msg) {
  let oceanIdx = oceans.findIndex( resp => resp.oId == msg.oid );
  let ocean = oceans[oceanIdx];
  
  // all captains have committed carriers
  // then send initiate game
  let allCommitted = true;
  for(let i=0; i < ocean.tms.length; i++) {
    const t = ocean.tms[i];
    if (!t.commit) {
      allCommitted = false;
      break;
    }
  }

  if (allCommitted) {
    ocean.ready = true;
    // broadcast to all clients in this ocean
    io.sockets.in(msg.oid).emit('initiateGame', ocean);
  } else {
    // send message to primary captain "not all teams have committed a carrier yet"
    const pSid = ocean.tms[0].plrs[0].pSid;
    io.to(pSid).emit('notAllCommitted', 'Not all teams have committed a carrier yet');
  }

}


/***************************************************************
* processCommitCarrier
***************************************************************/ 
function processCommitCarrier(msg, pSid) {

  let oceanIdx = oceans.findIndex( resp => resp.oId == msg.oid );
  let ocean = oceans[oceanIdx];
  ocean.tms[msg.tIdx].commit = true;
  oceans[oceanIdx] = ocean;

  // find board socket id that this player belongs to
  const boardSocketid = ocean.boardSocketId;

  // send back success message to the board
  io.to(boardSocketid).emit('carrierCommitted', ocean);

  // send back success message to client
  io.to(pSid).emit('carrierCommitted', '');
}


/***************************************************************
* processRemoveCarrier
***************************************************************/ 
function processRemoveCarrier(msg, pSid) {
  let oceanIdx = oceans.findIndex( resp => resp.oId == msg.oid );
  let ocean = oceans[oceanIdx];
  let teamIdx = ocean.tms.findIndex( resp => resp.clr == msg.teamClr );
  let team = ocean.tms.filter(resp => {
    return resp.clr == msg.teamClr;
  })[0];

  team.c1x = -10;
  team.c1y = -10;
  team.c2x = -10;
  team.c2y = -10;

  // update ocean
  oceans[oceanIdx].tms[teamIdx] = team;

  // find board socket id that this player belongs to
  const boardSocketid = ocean.boardSocketId;

  // send back success message to the board
  io.to(boardSocketid).emit('removedCarrier', ocean);

  // send back success message to client
  io.to(pSid).emit('removedCarrier', team);
}


/***************************************************************
* processPlaceCarrier
***************************************************************/ 
function processPlaceCarrier(msg, pSid) {
  let oceanIdx = oceans.findIndex( resp => resp.oId == msg.oid );
  let ocean = oceans[oceanIdx];
  // console.log(ocean);
  let teamIdx = ocean.tms.findIndex( resp => resp.clr == msg.teamClr );
  let team = ocean.tms.filter(resp => {
    return resp.clr == msg.teamClr;
  })[0];

  let firstPoint = false;

  // determine if this is point 1 or point 2
  if (team.c1x == -10) {
    firstPoint = true;
  }

  // make sure its not within x squares of another carrier 
  const minDist = ocean.config.carrierMinDist;
  const tooClose = measureDistance(msg.x, msg.y, ocean.tms, msg.teamClr, minDist);
  if (tooClose) {
    io.to(pSid).emit(
        'tooClose'
      , `You must place your carrier at least ${minDist} tiles away from an enemy carrier`
    );
    return;
  }

  if (firstPoint) {
    team.c1x = msg.x;
    team.c1y = msg.y;
    team.dir1 = 'south';
    team.dir2 = 'north';
  } else {
    // make sure point 1 is attached to point 2 
    if (isAttached(msg.x, msg.y, team.c1x, team.c1y)) {
      team.c2x = msg.x;
      team.c2y = msg.y;
      setStartingDirections(team);
    } else { // not attached
      // send error
      io.to(pSid).emit('notAttached', 'Your second tile must be attached to the first');
      return;
    }
  }

  // update ocean
  oceans[oceanIdx].tms[teamIdx] = team;

  // find board socket id that this player belongs to
  const boardSocketid = ocean.boardSocketId;

  // send back success message to the board
  io.to(boardSocketid).emit('placedCarrier', ocean);

  // send back success message to client
  io.to(pSid).emit('placedCarrier', team);
}


/***************************************************************
* measureDistance
***************************************************************/
function measureDistance(x, y, tms, teamClr, minDist) {
  let tooClose = false;
  const otherTeams = tms.filter(rec => {
    return rec.clr != teamClr;
  });
  for (let i=0; i<otherTeams.length; i++) {
    const ot = otherTeams[i];
    if ( (Math.abs(ot.c1x - x) < minDist) && (Math.abs(ot.c1y - y) < minDist) ) { tooClose = true; }
    if ( (Math.abs(ot.c2x - x) < minDist) && (Math.abs(ot.c2y - y) < minDist) ) { tooClose = true; }
  }
  return tooClose;
}


/***************************************************************
* setStartingDirections
***************************************************************/
function setStartingDirections(team) {
  let dir1 = "";
  let dir2 = "";

  if(team.c2x > team.c1x) {
    dir1 = 'east';
    dir2 = 'west';
  } else if(team.c2y > team.c1y) {
    dir1 = 'south';
    dir2 = 'north';
  } else if(team.c2x < team.c1x) {
    dir1 = 'west';
    dir2 = 'east';
  } else if(team.c2y < team.c1y) {
    dir1 = 'north';
    dir2 = 'south';
  }

  team.dir1 = dir1;
  team.dir2 = dir2;
}


/***************************************************************
* isAttached
***************************************************************/ 
function isAttached(x1, y1, x2, y2) {
  const xDiff = Math.abs(x2 - x1);
  const yDiff = Math.abs(y2 - y1);
  if ((xDiff == 1 && yDiff == 0) || (xDiff == 0 && yDiff == 1)) {
    return true;
  }
  return false;
}


/***************************************************************
* processCreateOcean
***************************************************************/ 
function processCreateOcean(msg, bSid, socket) {
  boardSocketids.push(bSid);
  socket.join(msg.oId); // join this room
  const ocean = {
      oId: msg.oId
    , round: 0
    , ready: false
    , boardSocketId: bSid
    , config: msg.config
    , tms: []
  };
  oceans.push(ocean);

  // send back success message to the board
  io.to(bSid).emit('oceanCreated', {
    msg: msg,
    ocean: ocean,
    boardSocketid: bSid,
    oceanCount: oceans.length,
    clientsConnected: clientsConnected
  });

}


/***************************************************************
* processCreatePlayer find out if anyone is on this colors team yet
* data = {
    ocean: 1
    name: "nick"
    team: "red"
* }this.oceanId
***************************************************************/ 
function processCreatePlayer(data, pSid, socket) {
  socket.join(data.ocean); // join this room
  // does this ocean exist?
  let oceanIdx = oceans.findIndex( resp => resp.oId == data.ocean );

  if (oceanIdx == -1) {
    const msgId = 'oceanDne';
    const error = `Ocean ID: ${data.ocean} does not exist`;
    io.to(pSid).emit(msgId, error);
  } else if ( oceans[oceanIdx].ready) {
    const msgId = 'inProgress';
    const error = `Ocean ID: ${data.ocean} already in progress. Please choose another Ocean ID`;
    io.to(pSid).emit(msgId, error);
  } else { // ocean exists
    updateOcean(oceanIdx, data, pSid);
  }
}


/***************************************************************
* updateOcean - with new player
***************************************************************/
function updateOcean(oceanIdx, data, pSid) {
  let captain = false;
  let ocean = oceans[oceanIdx];
  let pId = 1;
  let teamIdx;

  // make sure no one else in this ocean has this name
  if (containsPerson(ocean, data.name)) {
    const msgId = 'errSameName';
    const error = `${data.name} already exists in this ocean. Please choose another player name.`;
    console.log(msgId);
    console.log(error);
    io.to(pSid).emit(msgId, error);
    return;
  }
  
  if (ocean.tms.length == 0) { // no teams yet
    teamIdx = 0;
    ocean.tms.push( createNewTeam(ocean, data, pSid) );
    captain = true;
  } else { // at least one team is in this ocean
    // does your team exist?
    teamIdx = ocean.tms.findIndex( resp => resp.clr == data.team );
    if (teamIdx == -1) {
      teamIdx = ocean.tms.length;
      // team does not exist yet, so create new team
      ocean.tms.push( createNewTeam(ocean, data, pSid) );
      captain = true;
    } else { 
      // team exists
      pId = updateTeam(teamIdx, ocean, data, pSid); // directly modifying the ocean variable
    }
  }
  
  // team is full
  if (pId > 6 ) 
  { 
    const error = `The ${data.team} team is full and cannot accept any new members`;
    io.to(pSid).emit('teamFull', error);
  }
  else // team not full yet
  {
    oceans[oceanIdx] = ocean;

    // find board socket id that this player belongs to
    const boardSocketid = ocean.boardSocketId;

    // send back success message to the board
    io.to(boardSocketid).emit('playerCreated', {
        //tms: tms, // remove
        ocean: ocean,
        boardSocketid: boardSocketid,
        oceanCount: oceans.length,
        clientsConnected: clientsConnected
    });

    // send back success message to client
    io.to(pSid).emit('playerCreated', {
        captain: captain 
      , pId: pId
      , pSid: pSid
      , boardSocketid: boardSocketid
      , oceanId: data.ocean
      , name: data.name
      , teamClr: data.team
      , oceanConfig: ocean.config

      , teamIdx: teamIdx
      , x: -10
      , y: -10
      , dir: ''
      , alt: 0
      , fuel: 0
      , dmg: 0
      , drn: ''
      , diedX: -10
      , diedY: -10
      , dirCmd: ''
      , mvmCmd: "strAsc"
      , nextTile: {
          x: 1
        , y: 2
        , dir: 'west'
      }
    });

  }
  
}


/***************************************************************
* containsPerson
***************************************************************/
function containsPerson(o, n) {
  const teams = o.tms;
  let names = [];
  teams.forEach(rec => {
    let plrs = rec.plrs;
    plrs.forEach(p => {
      names.push(p.nm);
    });
  });
  if(names.includes(n)) {
    return true;
  }
  return false;
}


/***************************************************************
* createNewTeam - called for the first player on each new team
***************************************************************/
function createNewTeam(ocean, data, pSid) {

  // create a new player
  let player = createPlrObj(ocean, 1, data.name, 'C', pSid);

  // create new team
  let team = {
    commit: false
  , clr: data.team
  , c1x: -10
  , c1y: -10
  , c2x: -10
  , c2y: -10
  , dmg: 0
  , plrs: [player]
  };

  return team;
}


/***************************************************************
* updateTeam 
***************************************************************/
function updateTeam(teamIdx, ocean, data, pSid) {

  let pId = ocean.tms[teamIdx].plrs.length + 1;
  let name = data.name;
  let role = ""; // non captains here

  // team is not full yet
  if (pId < 6) 
  {
    // push this player onto his team
    ocean.tms[teamIdx].plrs.push(
      createPlrObj(ocean, pId, name, role, pSid)
    );
  } 

  return pId;
}


/***************************************************************
* createPlrObj 
***************************************************************/
function createPlrObj(ocean, pId, name, role, pSid) {
  return {
      id: pId
    , pSid: pSid
    , nm: name
    , rl: role
    , x: -10
    , y: -10
    , dir: "null"
    , alt: 0
    , fuel: ocean.config.fighterFuel
    , dmg: 0
    , drn: ""
    , diedX: -10
    , diedY: -10
    , status: 'alive'
    , dirCmd: "" // west
    , mvmCmd: "strAsc" // strAsc
  };
}


/***************************************************************
* removeOceanIfSocketIsBoard
***************************************************************/
function removeOceanIfSocketIsBoard(socket) {
  bsidIdx = -1;
  if ( boardSocketids.includes(socket.id) ) {
    // remove that ocean from oceans
    for (let i=0; i<oceans.length; i++) {
      let oc = oceans[i];
      if (socket.id == oc.boardSocketId) {
        bsidIdx = i;
      }
    }
    if (bsidIdx != -1) {
      oceans.splice(bsidIdx, 1);
    }
  }
}

