function logout(){sessionStorage.clear();location.href=location.pathname.includes('/admin/')?'../index.html':'index.html'}
function users(){return JSON.parse(localStorage.getItem('ae_users')||'[]')}
function records(){return JSON.parse(localStorage.getItem('ae_attendance')||'[]')}
function current(){let id=sessionStorage.getItem('ae_student');return users().find(x=>x.student_id===id)}
function guard(){if(!sessionStorage.getItem('ae_role'))location.href=location.pathname.includes('/admin/')?'../index.html':'index.html'}
guard();
if(document.getElementById('welcome')){let s=current(),r=records().filter(x=>x.student_id===s.student_id),total=r.length,present=r.filter(x=>x.status==='Present').length,abs=total-present,pct=total?present/total*100:0;
document.getElementById('welcome').textContent='Welcome, '+s.name;document.getElementById('studentInfo').textContent='Roll Number: '+s.roll_number;
document.getElementById('stats').innerHTML=[['Total Classes',total],['Present',present],['Absent',abs],['Attendance',pct.toFixed(1)+'%']].map(x=>`<div class="stat"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('');
document.getElementById('percent').textContent=pct.toFixed(1)+'%';document.querySelector('.circle').style.background=`conic-gradient(#6d4aff ${pct*3.6}deg,#edf0f5 0deg)`;
document.getElementById('status').textContent=total?(pct>=75?'Attendance is above 75%':'Attendance is below 75%'):'No attendance records yet';
document.getElementById('status').className='status '+(pct<75&&total?'danger':'');
document.getElementById('summary').innerHTML=`<p>Present classes: <b>${present}</b></p><p>Absent classes: <b>${abs}</b></p><div class="bar"><i style="width:${pct}%"></i></div><p>${pct.toFixed(1)}% attendance</p>`;
let w=document.getElementById('warning');if(total&&pct<75){let need=Math.max(0,Math.ceil((.75*total-present)/.25));w.classList.remove('hidden');w.innerHTML=`⚠️ Attendance is ${pct.toFixed(1)}%. Attend the next <b>${need}</b> consecutive classes to reach 75%.`}else w.classList.add('hidden');
let recent=[...r].reverse().slice(0,5);document.getElementById('recent').innerHTML=table(recent)}
if(document.getElementById('pname')){let s=current();document.getElementById('pname').textContent=s.name;document.getElementById('proll').textContent='Roll Number: '+s.roll_number;document.getElementById('pid').textContent='Student ID: '+s.student_id;document.getElementById('avatar').textContent=s.name[0].toUpperCase()}
function table(arr){if(!arr.length)return '<p class="muted">No records found.</p>';return '<div class="table-wrap"><table><tr><th>Date</th><th>Subject</th><th>Status</th><th>Time</th></tr>'+arr.map(x=>`<tr><td>${x.date}</td><td>${x.subject}</td><td><span class="badge ${x.status.toLowerCase()}">${x.status}</span></td><td>${x.marked_time||'-'}</td></tr>`).join('')+'</table></div>'}