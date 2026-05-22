<template>
  <div class="demo">
    <h1>MonitorX Vue3 Demo</h1>
    <button v-monitor:click="'submit_btn'" @click="handleClick">提交（v-monitor）</button>
    <button type="button" @click="triggerError">触发 JS 错误</button>
  </div>
</template>

<script setup lang="ts">
import { useMonitor } from '@lixue2018/monitorx-vue';

const monitor = useMonitor();

function handleClick() {
  monitor?.reportEvent({
    type: 'custom_click',
    button_name: 'submit',
  });
  monitor?.reportPerformance({
    type: 'api_response',
    api: '/api/submit',
    duration: 150,
  });
}

function triggerError() {
  throw new Error('MonitorX demo error');
}
</script>

<style scoped>
.demo {
  font-family: system-ui, sans-serif;
  padding: 24px;
}
button {
  margin-right: 8px;
}
</style>
