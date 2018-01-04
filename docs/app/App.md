# App

App 是用以定义小程序的类。

在代码编译阶段，通过类生成的实例将会被处理，处理结果会被传入 `App()` 函数中，供微信创建小程序使用。

传入 `App()` 的所有函数都可以在类中定义，包括生命周期函数、事件处理函数以及自定义函数。

## initData

`initData` 是一个特殊的函数，函数的返回值会被赋值到 `App()` 的参数中。

```javascript
import $ from '@mtfe/vxapp';

export default class extends $.App {
  ...
  initData() {
    return { name: 'test' };
  }
  ...
}
```

等价于

```javascript
App({
  data: {
    name: 'test'
  }
});
```

`initData` 函数可以用于小程序初始化之时的数据准备。