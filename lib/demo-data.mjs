// 演示数据 —— 全部内容均为虚构样例，仅用于展示交互流程。
// ⚠️ 本文件中的任何数据都不得作为真实调用证据，前端必须始终展示「演示」标识。

export const DEMO_FLAG = '演示';

export const demoStore = {
  id: 'demo-store-001',
  name: '麦当劳（示例商圈店）',
  city: '示例市',
  address: '示例路 1 号（演示数据）',
  businessArea: '示例商圈',
  dineIn: true,
  takeaway: true,
};

// 虚构菜单：字段结构与真实菜单对齐的目标是便于切换数据源，价格为虚构。
export const demoMenu = [
  { id: 'demo-m1', name: '巨无霸（演示）', price: 25.5, category: '主食', tags: ['汉堡', '牛肉'] },
  { id: 'demo-m2', name: '麦辣鸡腿堡（演示）', price: 23.0, category: '主食', tags: ['汉堡', '鸡肉', '辣'] },
  { id: 'demo-m3', name: '板烧鸡腿堡（演示）', price: 24.0, category: '主食', tags: ['汉堡', '鸡肉'] },
  { id: 'demo-m4', name: '麦香鱼（演示）', price: 15.5, category: '主食', tags: ['汉堡', '鱼'] },
  { id: 'demo-m5', name: '麦辣鸡翅 2 块（演示）', price: 12.0, category: '小食', tags: ['鸡肉', '辣', '小食'] },
  { id: 'demo-m6', name: '麦乐鸡 5 块（演示）', price: 13.5, category: '小食', tags: ['鸡肉', '小食'] },
  { id: 'demo-m7', name: '薯条 大（演示）', price: 13.0, category: '小食', tags: ['薯条', '小食'] },
  { id: 'demo-m8', name: '蔬菜色拉（演示）', price: 16.5, category: '小食', tags: ['蔬菜', '色拉'] },
  { id: 'demo-m9', name: '可口可乐 中杯（演示）', price: 9.5, category: '饮品', tags: ['可乐', '饮品'] },
  { id: 'demo-m10', name: '零度可乐 中杯（演示）', price: 9.5, category: '饮品', tags: ['可乐', '饮品', '无糖'] },
  { id: 'demo-m11', name: '圆筒冰淇淋（演示）', price: 5.0, category: '甜品', tags: ['甜品', '冰淇淋'] },
];

// 虚构优惠：结构对齐 calculate-price 需要的信息（条件、减免），实际减免以真实试算为准。
export const demoOffers = [
  {
    id: 'demo-o1',
    title: '双堡套餐省 6 元（演示）',
    condition: '同时购买任意 2 个主食类汉堡',
    scope: ['demo-m1', 'demo-m2', 'demo-m3', 'demo-m4'],
    discount: 6.0,
    note: '不与其他优惠同享',
  },
  {
    id: 'demo-o2',
    title: '小食买一送一（演示）',
    condition: '购买任意小食 2 份，第二份免费（按低价减免）',
    scope: ['demo-m5', 'demo-m6', 'demo-m7'],
    discount: null, // 动态：按较低价减免
    note: '每日限量',
  },
];

export const demoAvailability = {}; // 例：{ 'demo-m4': 0 } 表示某餐品无货；默认全部有货
