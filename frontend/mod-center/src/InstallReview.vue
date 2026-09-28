<script setup lang="ts">
import {computed} from 'vue';
import type {InstallPlan} from './install-plan';
const props=defineProps<{plan:InstallPlan}>();
const errors=computed(()=>props.plan.findings.filter(item=>item.severity==='error'));
const warnings=computed(()=>props.plan.findings.filter(item=>item.severity!=='error'));
const added=computed(()=>props.plan.items.filter(item=>item.previous===undefined).length);
</script>
<template>
 <section class="install-plan" aria-label="整批安装计划">
  <h3>安装计划 · {{plan.items.length}} 个模组</h3>
  <p class="next-help">新增 {{added}} · 更新 {{plan.items.length-added}} · {{plan.loadOrder?'同时调整加载顺序':'保持现有加载顺序'}}</p>
  <div v-if="errors.length" class="install-plan-errors" role="alert">
   <strong>需先处理 {{errors.length}} 项问题</strong>
   <ul><li v-for="finding in errors" :key="finding.id"><strong>{{finding.title}}</strong><small>{{finding.evidence.join('；')}}</small><small>{{finding.suggestion}}</small></li></ul>
  </div>
  <details><summary>查看模组明细 · {{plan.items.length}} 项</summary>
   <ul><li v-for="item in plan.items" :key="item.name">
    <div class="install-plan-item"><strong>{{item.name}}</strong><span>{{item.previous===undefined?'新增':'更新 '+item.previous+' → '}}{{item.version}}</span><span class="next-tag">{{item.enabled?'下次启用':'保持禁用'}}</span></div>
    <small v-if="item.sourceKey">{{item.sourceKey}} · {{item.release}} · {{item.asset}}</small>
    <small v-if="item.dependencies.length">声明的依赖：{{item.dependencies.map(d=>d.name+' '+d.version).join('；')}}</small>
   </li></ul>
  </details>
  <details v-if="warnings.length"><summary>其他检查提示 · {{warnings.length}} 项</summary>
   <ul><li v-for="finding in warnings" :key="finding.id"><strong>{{finding.title}}</strong><small>{{finding.evidence.join('；')}}</small><small>{{finding.suggestion}}</small></li></ul>
  </details>
  <details v-if="plan.loadOrder"><summary>查看调整后的加载顺序 · {{plan.loadOrder.length}} 项</summary><ol><li v-for="name in plan.loadOrder" :key="name">{{name}}</li></ol><p v-for="warning in plan.sortWarnings" :key="warning" class="next-help">{{warning}}</p></details>
  <p v-if="!plan.findings.length" class="next-help">可检查范围内未发现依赖问题；仍需重启后观察运行情况。</p>
 </section>
</template>
<style scoped>
.install-plan h3{margin:0 0 4px}.install-plan>p{margin:4px 0 10px}.install-plan details{border-top:1px solid #595164}.install-plan summary{cursor:pointer;padding:9px 0}.install-plan ul,.install-plan ol{margin:2px 0 10px;padding-left:20px;max-height:18vh;overflow:auto}.install-plan li{padding:5px 0;overflow-wrap:anywhere}.install-plan small{display:block;white-space:normal;margin-top:3px}.install-plan-item{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.install-plan-item strong{margin-right:auto}.install-plan .next-tag{display:inline-block}.install-plan-errors{border:1px solid #a66d76;border-radius:8px;padding:8px 12px}.install-plan-errors ul{max-height:18vh}
</style>
