// 弹窗拦截器 - 自动拦截TEMU页面的弹窗
(function(){
  const o=Element.prototype.appendChild,p=['5-120-1','5-118-0'];
  let c=0;

  Element.prototype.appendChild=function(e){
    // 插入到body的div元素
    if(this===document.body&&e&&e.tagName==='DIV'){
      const t=e.getAttribute('data-testid');

      // 目标元素
      if(t==='beast-core-modal'||t==='beast-core-modal-mask'){
        const n=e.className||'';
        let a=false;

        // 检查class
        for(const s of p){
          if(n.includes(s)){
            a=true;
            break;
          }
        }

        // 不允许则拦截
        if(!a){
          console.log(`拦截弹窗${t} [${++c}]，class:"${n}"`);
          const d=document.createElement('div');
          d.style.cssText='display:none!important;height:0!important;width:0!important;';
          return o.call(this,d);
        }
      }
    }

    return o.call(this,e);
  };
  console.log('✅拦截器启动，允许编号:',p);
})();
