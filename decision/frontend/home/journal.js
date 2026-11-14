const entries=[...document.querySelectorAll('.journal-entry')];
const search=document.getElementById('journal-search');
let topic='all';
function filter(){
  const query=search.value.trim().toLocaleLowerCase();let count=0;
  for(const entry of entries){entry.hidden=(topic!=='all'&&entry.dataset.topic!==topic)||!entry.dataset.search.toLocaleLowerCase().includes(query);if(!entry.hidden)count++;}
  document.getElementById('journal-empty').hidden=count>0;
}
document.querySelectorAll('button[data-topic]').forEach(button=>button.addEventListener('click',()=>{
  topic=button.dataset.topic;document.querySelectorAll('button[data-topic]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));filter();
}));
search.addEventListener('input',filter);
function route(){
  const article=[...document.querySelectorAll('[data-article]')].find(item=>'#'+item.dataset.article===location.hash);
  document.getElementById('journal-index').hidden=!!article;
  document.querySelectorAll('[data-article]').forEach(item=>item.hidden=item!==article);
  document.title=(article?article.querySelector('h1').textContent:'项目博客')+' · 微境探界';
  window.scrollTo({top:0,behavior:'instant'});
}
addEventListener('hashchange',route);route();
