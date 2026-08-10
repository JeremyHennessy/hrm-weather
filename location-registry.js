/* Generated from locations.json. Do not hand-edit location definitions here. */
(()=>{
  const locations={
    hrm:{label:'HRM CORE',place:'Halifax Peninsula · Bedford · Dartmouth',timezone:'America/Halifax',country:'CA',points:[['Halifax Peninsula',44.6488,-63.5752],['Bedford',44.7318,-63.6619],['Dartmouth',44.6661,-63.5676]]},
    moncton:{label:'MONCTON NB',place:'Downtown Moncton',timezone:'America/Moncton',country:'CA',points:[['Moncton',46.0878,-64.7782]]},
    shediac:{label:'SHEDIAC NB',place:'Shediac town centre',timezone:'America/Moncton',country:'CA',points:[['Shediac',46.2198,-64.5411]]},
    lunenburg:{label:'LUNENBURG NS',place:'Lunenburg',timezone:'America/Halifax',country:'CA',points:[['Lunenburg',44.377896,-64.309529]]},
    wolfville:{label:'WOLFVILLE NS',place:'Wolfville · New Minas · Kentville',timezone:'America/Halifax',country:'CA',points:[['Wolfville',45.091713,-64.359242],['New Minas',45.067858,-64.460234],['Kentville',45.077707,-64.495306]]},
    uws:{label:'UPPER WEST SIDE NY',place:'Upper West Side · Manhattan',timezone:'America/New_York',country:'US',points:[['UWS South',40.7745,-73.9840],['UWS Central',40.787,-73.9754],['UWS North',40.795,-73.9705]]}
  };
  window.WX_LOCATION_REGISTRY=Object.freeze({version:1,locations:Object.freeze(locations)});
  window.WXLocation=key=>window.WX_LOCATION_REGISTRY.locations[key]||window.WX_LOCATION_REGISTRY.locations.hrm;
})();
