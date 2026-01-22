# Components 组件模块

> [根目录](../CLAUDE.md) > **components**

---

## 变更记录 (Changelog)

### 2026-01-22
- **[新建]** 初始化组件模块文档
- **[扫描]** 完成组件文件扫描，识别5个核心组件
- **[覆盖率]** 已扫描 5/5 组件文件 (100%)

---

## 模块职责

`components/` 模块是吃瓜社应用的**UI组件集合**，负责实现所有用户界面元素与交互逻辑。模块采用**手绘涂鸦风格**设计，提供一致的视觉体验和可复用的UI组件。

**核心职责**：
- 提供4个主要视图组件（首页、投稿、热门、后台）
- 提供手绘风格的基础UI组件库（按钮、卡片、徽章等）
- 管理组件级状态与交互逻辑
- 实现响应式布局与移动端适配

---

## 入口与启动

### 组件导入方式

组件通过相对路径导入到 `App.tsx` 中：

```typescript
import HomeView from './components/HomeView';
import SubmissionView from './components/SubmissionView';
import FeedView from './components/FeedView';
import AdminDashboard from './components/AdminDashboard';
import { SketchButton, SketchCard, Badge } from './components/SketchUI';
```

### 组件使用示例

```typescript
// 在 App.tsx 中使用视图组件
const renderView = () => {
  switch (currentView) {
    case ViewType.HOME:
      return <HomeView onNavigate={setCurrentView} />;
    case ViewType.SUBMISSION:
      return <SubmissionView />;
    case ViewType.FEED:
      return <FeedView />;
    case ViewType.ADMIN:
      return <AdminDashboard />;
  }
};

// 使用 SketchUI 基础组件
<SketchButton variant="primary" fullWidth>
  提交内容
</SketchButton>

<SketchCard rotate className="p-6">
  <h2>卡片标题</h2>
  <p>卡片内容</p>
</SketchCard>
```

---

## 对外接口

### 视图组件

#### HomeView
**路径**: `components/HomeView.tsx`
**职责**: 显示最新吃瓜内容的卡片式视图

**接口定义**:
```typescript
interface HomeViewProps {
  onNavigate: (view: ViewType) => void;
}
```

**功能特性**:
- 轮播展示最新帖子（3条 Mock 数据）
- 支持点赞、踩、评论、举报操作
- 热链接图片展示
- 手绘风格卡片与阴影效果

**关键状态**:
- `currentIndex`: 当前展示的帖子索引
- `animate`: 切换动画状态

---

#### SubmissionView
**路径**: `components/SubmissionView.tsx`
**职责**: 匿名内容投稿表单

**接口定义**:
```typescript
// 无 props，独立组件
```

**功能特性**:
- 多行文本输入（500字限制）
- 字数统计显示
- 手绘横线纸张效果
- Emoji 选择器（UI存在，功能待实现）

**关键状态**:
- `text`: 用户输入的内容
- `maxLength`: 最大字符限制（500）

---

#### FeedView
**路径**: `components/FeedView.tsx`
**职责**: 热门内容列表视图

**接口定义**:
```typescript
// 无 props，独立组件
```

**功能特性**:
- 显示带排名的热门帖子列表（4条 Mock 数据）
- 榜单前三名特殊标识（红色/白色/黄色背景）
- 标签系统（爆料、咖啡店、奇葩等）
- 时间筛选器（本周/今日/历史）

**子组件**:
```typescript
const PostItem: React.FC<{ post: Post }> = ({ post }) => { ... }
```

---

#### AdminDashboard
**路径**: `components/AdminDashboard.tsx`
**职责**: 管理员审核后台

**接口定义**:
```typescript
// 无 props，独立组件
```

**功能特性**:
- 侧边栏导航（举报列表、处理、统计）
- 数据统计卡片（今日举报、封禁用户）
- 图表可视化（访问量、发帖量）
- 举报列表与处理操作（忽略、删除、封禁）

**数据模型**:
- `StatCard`: 统计卡片组件
- `VISIT_DATA`: 访问量数据（7天）
- `POST_VOLUME_DATA`: 发帖量数据（7天）
- `REPORTS`: 举报列表（3条 Mock 数据）

**依赖库**:
- Recharts: `BarChart`、`LineChart` 用于数据可视化
- Lucide React: 图标库

---

#### SketchUI (组件库)
**路径**: `components/SketchUI.tsx`
**职责**: 提供手绘风格的基础UI组件

**导出接口**:

##### 工具类
```typescript
export const roughBorderClass: string;      // 大尺寸不规则边框
export const roughBorderClassSm: string;    // 小尺寸不规则边框
```

##### SketchButton
```typescript
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  fullWidth?: boolean;
}

export const SketchButton: React.FC<ButtonProps>;
```

**变体说明**:
- `primary`: 黑底白字，大阴影
- `secondary`: 白底黑字，中等阴影
- `danger`: 红底黑字，sketch 阴影
- `ghost`: 透明背景，无阴影

##### SketchCard
```typescript
interface CardProps {
  children: React.ReactNode;
  className?: string;
  rotate?: boolean;  // 启用旋转效果
}

export const SketchCard: React.FC<CardProps>;
```

##### Tape (装饰元素)
```typescript
export const Tape: React.FC<{ className?: string }>;
```
用途：在卡片顶部添加透明胶带效果

##### Badge (标签)
```typescript
export const Badge: React.FC<{
  children: React.ReactNode;
  color?: string;  // 背景色类名（默认 bg-gray-100）
}>;
```

---

## 关键依赖与配置

### 外部依赖

| 依赖库 | 版本 | 用途 | 使用位置 |
|--------|------|------|----------|
| `react` | 19.2.3 | 核心框架 | 所有组件 |
| `lucide-react` | 0.562.0 | 图标库 | SubmissionView, FeedView, AdminDashboard |
| `recharts` | 3.7.0 | 图表库 | AdminDashboard |
| `react-dom` | 19.2.3 | DOM 操作 | 所有组件 |

### 内部依赖

| 模块 | 导入路径 | 用途 |
|------|----------|------|
| `types.ts` | `../types` | 类型定义（Post、Report、ViewType等） |
| `SketchUI.tsx` | `./SketchUI` | 基础UI组件 |

### TailwindCSS 自定义配置

组件依赖 `index.html` 中的 Tailwind 配置：

```javascript
theme: {
  extend: {
    colors: {
      paper: '#f9f7f1',       // 纸张背景
      ink: '#2c2c2c',          // 墨水黑
      pencil: '#555555',       // 铅笔灰
      highlight: '#fff59d',    // 高亮黄
      alert: '#fca5a5',        // 警告红
      'accent-blue': '#b3e5fc',
      'accent-pink': '#ffcdd2',
    },
    fontFamily: {
      hand: ['"Zhi Mang Xing"', '"Patrick Hand"', 'cursive'],
      sans: ['"Noto Sans SC"', 'sans-serif'],
      display: ['"Ma Shan Zheng"', 'cursive'],
    },
    boxShadow: {
      'sketch': '2px 2px 0px 0px #000000',
      'sketch-lg': '5px 5px 0px 0px #000000',
      'sketch-hover': '4px 4px 0px 0px #000000',
      'sketch-active': '0px 0px 0px 0px #000000',
    },
  }
}
```

---

## 数据模型

### Post (帖子)
```typescript
interface Post {
  id: string;
  content: string;
  author: string;
  timestamp: string;
  location?: string;
  likes: number;
  comments: number;
  tags?: string[];
  rank?: number;
  isHot?: boolean;
  imageUrl?: string;
}
```

### Report (举报)
```typescript
interface Report {
  id: string;
  targetId: string;
  reason: string;
  contentSnippet: string;
  timestamp: string;
  status: 'pending' | 'resolved' | 'ignored';
  riskLevel: 'low' | 'medium' | 'high';
}
```

### ViewType (视图类型)
```typescript
enum ViewType {
  HOME = 'HOME',
  SUBMISSION = 'SUBMISSION',
  FEED = 'FEED',
  ADMIN = 'ADMIN'
}
```

---

## 测试与质量

### 当前状态
⚠️ **无测试覆盖**

### 建议测试用例

#### HomeView
```typescript
describe('HomeView', () => {
  it('应该渲染当前帖子的内容', () => {});
  it('点击"下一个瓜"按钮应切换到下一条帖子', () => {});
  it('到达最后一条时应循环回第一条', () => {});
  it('应该正确显示点赞数和评论数', () => {});
  it('点击评论按钮应导航到 FEED 视图', () => {});
});
```

#### SubmissionView
```typescript
describe('SubmissionView', () => {
  it('应该限制输入字符数为500', () => {});
  it('应该实时显示字符计数', () => {});
  it('应该阻止表单默认提交行为', () => {});
});
```

#### SketchUI
```typescript
describe('SketchButton', () => {
  it('应该渲染正确的变体样式', () => {});
  it('fullWidth prop 应使按钮宽度100%', () => {});
  it('应该传递 HTML 按钮属性', () => {});
});

describe('SketchCard', () => {
  it('rotate prop 应添加旋转类', () => {});
  it('应该渲染子元素', () => {});
});
```

---

## 常见问题 (FAQ)

### Q1: 如何添加新的视图组件？
**A**:
1. 在 `components/` 目录创建新组件文件（如 `ProfileView.tsx`）
2. 参考 `HomeView.tsx` 的结构，使用 SketchUI 组件
3. 在 `types.ts` 的 `ViewType` 枚举中添加新类型
4. 在 `App.tsx` 的 `renderView()` 中添加路由逻辑
5. 在导航栏添加对应的导航项

### Q2: 如何自定义 Sketch 风格样式？
**A**:
- 修改 `SketchUI.tsx` 中的 `roughBorderClass` 常量
- 调整 `index.html` 中的 TailwindCSS 配置
- 使用 `shadow-sketch` 系列工具类
- 参考现有组件的样式模式（如 `doodle-border`、`transform rotate-*`）

### Q3: Mock 数据在哪里？
**A**:
- `HomeView.tsx`: `HOME_POSTS` 数组（3条）
- `FeedView.tsx`: `MOCK_POSTS` 数组（4条）
- `AdminDashboard.tsx`: `VISIT_DATA`、`POST_VOLUME_DATA`、`REPORTS`

### Q4: 如何集成真实 API？
**A**:
1. 创建 `services/api.ts` 模块
2. 使用 `fetch` 或 `axios` 封装 API 调用
3. 在组件中用 `useEffect` 替换 Mock 数据
4. 添加加载状态与错误处理

### Q5: 为什么 Emoji 选择器没有功能？
**A**: 当前仅为 UI 占位，需要：
1. 安装 `emoji-picker-react` 库
2. 在 `SubmissionView` 中集成 picker 组件
3. 将选中的 emoji 插入到 `text` 状态中

---

## 相关文件清单

### 核心组件文件
- `HomeView.tsx` - 首页视图（141 行）
- `SubmissionView.tsx` - 投稿视图（73 行）
- `FeedView.tsx` - 热门视图（134 行）
- `AdminDashboard.tsx` - 后台视图（219 行）
- `SketchUI.tsx` - UI组件库（63 行）

### 依赖文件
- `../types.ts` - 类型定义
- `../index.html` - TailwindCSS 配置与字体引入
- `../App.tsx` - 主应用组件（使用所有视图）

---

## 性能优化建议

### 当前性能瓶颈
1. **未使用 React.memo**: 所有组件在父组件重渲染时都会重渲染
2. **Mock 数据硬编码**: 每次渲染都重新创建数组对象
3. **无代码分割**: 所有组件在初始加载时全部打包

### 优化方案

#### 1. 使用 React.memo
```typescript
export default React.memo(HomeView, (prevProps, nextProps) => {
  return prevProps.onNavigate === nextProps.onNavigate;
});
```

#### 2. 将 Mock 数据移到模块顶层
```typescript
// ✅ 好的做法 - 已实现
const HOME_POSTS: Post[] = [ ... ];

// ❌ 避免
function HomeView() {
  const posts = [ ... ];  // 每次渲染都重新创建
}
```

#### 3. 使用 React.lazy 实现代码分割
```typescript
// 在 App.tsx 中
const HomeView = React.lazy(() => import('./components/HomeView'));
const AdminDashboard = React.lazy(() => import('./components/AdminDashboard'));

// 使用 Suspense 包裹
<Suspense fallback={<div>加载中...</div>}>
  {renderView()}
</Suspense>
```

#### 4. 使用 useMemo 缓存计算结果
```typescript
const sortedPosts = useMemo(() => {
  return posts.sort((a, b) => b.likes - a.likes);
}, [posts]);
```

---

## 无障碍性改进

### 当前问题
- ❌ 缺少语义化 HTML 标签
- ❌ 缺少 ARIA 标签
- ❌ 按钮缺少明确的 `aria-label`
- ❌ 键盘导航支持不完整

### 改进建议

#### 1. 添加语义化标签
```typescript
// ❌ 之前
<div className="header">...</div>

// ✅ 改进后
<header role="banner" aria-label="主导航栏">...</header>
```

#### 2. 添加 ARIA 属性
```typescript
<button
  aria-label="点赞"
  aria-pressed={isLiked}
  onClick={handleLike}
>
  <ThumbsUp />
</button>
```

#### 3. 键盘导航
```typescript
const handleKeyPress = (e: React.KeyboardEvent) => {
  if (e.key === 'ArrowRight') {
    handleNext();
  } else if (e.key === 'ArrowLeft') {
    handlePrevious();
  }
};

<div onKeyDown={handleKeyPress} tabIndex={0}>
  {/* 内容 */}
</div>
```

---

**文档生成**: 由 Claude Code 自适应架构师自动生成
**最后更新**: 2026-01-22T13:04:48+0800
