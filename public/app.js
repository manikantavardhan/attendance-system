const $=s=>document.querySelector(s);
let mode="student";
$("#studentTab").onclick=()=>{mode="student";$("#studentTab").classList.add("on");$("#adminTab").classList.remove("on");$("#name").placeholder="Your name";$("#pass").placeholder="Roll number"};
$("#adminTab").onclick=()=>{mode="admin";$("#adminTab").classList.add("on");$("#studentTab").classList.remove("on");$("#name").placeholder="Admin username";$("#pass").placeholder="Admin password"};
$("#login").onsubmit=async e=>{e.preventDefault();$("#err").textContent="";
const url=mode==="student"?"/api/login":"/api/admin-login";
const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:$("#name").value,password:$("#pass").value})});
const d=await r.json();if(!r.ok){$("#err").textContent=d.error||"Login failed";return}
location.href=mode==="student"?"/dashboard.html":"/admin";};