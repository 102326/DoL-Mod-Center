<script setup lang="ts">
import type {InstallPlan} from './install-plan';
defineProps<{plan:InstallPlan}>();
</script>
<template>
 <section class="install-plan" aria-label="整批安装计划">
  <h3>安装计划 · {{plan.items.length}} 个模组</h3>
  <ul><li v-for="item in plan.items" :key="item.name">
   <strong>{{item.name}}</strong> · {{item.previous===undefined?'新增':'更新'}} {{item.previous===undefined?'':item.previous+' → '}}{{item.version}}
   <span class="next-tag">{{item.enabled?'下次启用':'保持禁用'}}</span>
   <small v-if="item.sourceKey">{{item.sourceKey}} · {{item.release}} · {{item.asset}}</small>
   <small v-if="item.dependencies.length">声明的依赖：{{item.dependencies.map(d=>d.name+' '+d.version).join('；')}}</small>
   <small v-else>包内未声明依赖；不代表已验证所有模组组合兼容。</small>
  </li></ul>
  <details v-if="plan.findings.length" open><summary>安装后组合检查 · {{plan.findings.length}} 项提示</summary>
   <ul><li v-for="finding in plan.findings" :key="finding.id" :class="{'next-error':finding.severity==='error'}">
    <strong>{{finding.title}}</strong><small>{{finding.evidence.join('；')}}</small><small>{{finding.suggestion}}</small>
   </li></ul>
  </details>
  <p v-else class="next-help">可检查范围内未发现依赖问题；不等于实机兼容验证。</p>
  <details v-if="plan.loadOrder" open><summary>依赖排序后的加载顺序</summary><p>{{plan.loadOrder.join(' → ')}}</p><p v-for="warning in plan.sortWarnings" :key="warning" class="next-help">{{warning}}</p></details>
  <p class="next-help">保持已有模组的启停状态，不自动下载依赖或启用前置。{{plan.loadOrder?'所示加载顺序与整批包一起保存，可通过启动恢复撤销。':'本次不调整加载顺序。'}}依赖提示包含现有组合的问题；可取消后补齐附件或调整配置，再重新预检。</p>
 </section>
</template>
<style scoped>
.install-plan ul{list-style:none;padding:0;margin:10px 0}.install-plan li{padding:10px 0;border-bottom:1px solid #595164;overflow-wrap:anywhere}.install-plan small{display:block;white-space:normal;margin-top:5px}.install-plan .next-tag{display:inline-block;margin:4px 8px}.install-plan summary{cursor:pointer}
</style>
