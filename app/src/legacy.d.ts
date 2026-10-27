declare module '*web/js/battle.js' {
  // 黑盒兼容面保留旧 API；新 UI 使用 session.ts 的显式类型。
  const legacy: Record<string, any>;
  export default legacy;
}
