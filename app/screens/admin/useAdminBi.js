import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { adminReadOwner } from './useAdminEvents';
import { getAdminBi } from '../../services/adminBiService';
import { adminReadError } from '../../services/adminEventsService';
export default function useAdminBi(navigation,eventId) {
  const auth=useAuth(),owner=adminReadOwner(auth),client=auth.httpClient;
  const scope=useMemo(()=>({}),[owner,client,eventId]);
  const live=useRef(null);live.current={scope,auth};
  const control=useRef(null),[snapshot,setSnapshot]=useState(null);
  useEffect(()=>{
    if(!owner)return undefined;
    let alive=true,generation=0,busy=false,timer=null,data=null;
    let active=AppState.currentState==='active'||AppState.currentState==null;
    const current=()=>alive&&live.current.scope===scope&&adminReadOwner(live.current.auth)===owner&&navigation.isFocused()&&active;
    async function refresh(){
      if(!current()||busy)return;
      busy=true;const ticket=generation;
      setSnapshot(previous=>({scope,data,pending:!data,refreshing:true,updatedAt:previous?.updatedAt}));
      try{
        const next=await getAdminBi(client,eventId);
        if(!current()||ticket!==generation)return;
        data=next;setSnapshot({scope,data,updatedAt:next.observedAt});
      }catch(error){
        if(!current()||ticket!==generation)return;
        if([401,403,404].includes(error?.status))data=null;
        setSnapshot(previous=>({scope,data,updatedAt:data?previous?.updatedAt:null,stale:Boolean(data),error:adminReadError(error)}));
      }finally{busy=false;if(current()&&ticket!==generation)void refresh();}
    }
    function stop(){generation++;if(timer)clearInterval(timer);timer=null;}
    function start(){stop();if(current()){void refresh();timer=setInterval(refresh,30000);}}
    const offFocus=navigation.addListener('focus',start),offBlur=navigation.addListener('blur',stop);
    const subscription=AppState.addEventListener('change',state=>{active=state==='active';if(active)start();else stop();});
    control.current={scope,refresh};start();
    return()=>{alive=false;stop();offFocus();offBlur();subscription.remove();};
  },[scope,owner,client,eventId,navigation]);
  return{...(owner&&snapshot?.scope===scope?snapshot:{pending:true}),refresh:()=>control.current?.scope===scope&&control.current.refresh()};
}
