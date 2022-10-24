
function test() {

    console.log('hello');

    const ocean = {
        tms:[
            {
                id: 12,
                plrs: [{x: 5, y:8, nm:'Nick'}]
            },
            {
                id: 34,
                plrs: [{x: 5, y:8, nm:'Kent'}]
            }
        ]
    }

    const player =  {x: 5, y:8, nm:'Kent'};
    const teamIdx = 1;
    const playerIdx = 0;
    let consoleMessage = 'foo';

    for (let i=0; i < ocean.tms.length; i++) {
        const team = ocean.tms[i];
        for(let j=0; j < team.plrs.length; j++) {
          if (i != teamIdx || j != playerIdx) { // its not me
            console.log('---');
            const jet = team.plrs[j];
            console.log('player.x', player.x);
            console.log('player.y', player.y);
            console.log('jet.x', jet.x);
            console.log('jet.y', jet.y);

            if (player.x == jet.x && player.y == jet.y) { // sharing same cell
              consoleMessage = player.nm
                + "'s fighter and " 
                + jet.nm
                + "'s fighter ran into each other";
            }
          } 
        }
    }
    console.log(consoleMessage);

}

test();