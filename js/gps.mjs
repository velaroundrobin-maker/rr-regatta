// Convert browser geolocation reports into a validated boat position.
// A position is useful even when the device cannot yet provide speed or heading.
import {bearing,distanceMeters,norm} from "./engine.mjs?v=0.7.2";

const KNOTS_PER_MPS = 1.9438444924406;

export function gpsFixFromPosition(position, previous=null, now=Date.now()) {
  const coords=position?.coords;
  if(!coords||!Number.isFinite(coords.latitude)||!Number.isFinite(coords.longitude)||
     Math.abs(coords.latitude)>90||Math.abs(coords.longitude)>180)return null;
  const time=Number.isFinite(position.timestamp)&&position.timestamp>0?position.timestamp:now;
  if(time>now+5000||now-time>45000)return null;
  const accuracy=Number.isFinite(coords.accuracy)&&coords.accuracy>=0?coords.accuracy:null;
  let sog=Number.isFinite(coords.speed)&&coords.speed>=0?coords.speed*KNOTS_PER_MPS:null;
  let cog=Number.isFinite(coords.heading)&&coords.heading>=0?norm(coords.heading):null;
  const fix={lat:coords.latitude,lon:coords.longitude,sog,cog,accuracy,time};
  if(previous&&Number.isFinite(previous.lat)&&Number.isFinite(previous.lon)){
    const dt=(time-previous.time)/1000;
    if(dt>=0.7&&dt<30){
      const distance=distanceMeters(previous,fix);
      const uncertainty=Math.max(5,(Number.isFinite(previous.accuracy)?previous.accuracy:accuracy??5),accuracy??5);
      if(sog===null)sog=distance<=uncertainty?0:distance/dt*KNOTS_PER_MPS;
      if(cog===null&&distance>uncertainty)cog=bearing(previous,fix);
    }
  }
  return {...fix,sog,cog};
}

export function gpsErrorInfo(error){
  switch(error?.code){
    case 1:return{terminal:true,title:"GPS non autorizzato",detail:"Consenti la posizione precisa nelle impostazioni del browser e riprova."};
    case 2:return{terminal:false,title:"GPS: segnale assente",detail:"Posizione non disponibile. Prova all'aperto e verifica che la localizzazione sia attiva."};
    case 3:return{terminal:false,title:"GPS: ricerca in corso",detail:"Tempo di ricerca superato. L'app continua a cercare il segnale; prova all'aperto."};
    default:return{terminal:false,title:"GPS: posizione non disponibile",detail:"Impossibile leggere la posizione. Verifica GPS e permessi del browser."};
  }
}
