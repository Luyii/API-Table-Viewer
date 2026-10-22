document.addEventListener('DOMContentLoaded',()=>{
  // Wait for real Worker parsing and request capture, not a mock panel renderer.
  let attempts=0;
  const ready=setInterval(()=>{
    const orders=requests.find(item=>item.url.includes('/api/orders?'));
    if(orders){clearInterval(ready);safe(async()=>{await selectRequest(orders);await openTable(['data','records']);})();}
    else if(++attempts>100)clearInterval(ready);
  },30);
},{once:true});
