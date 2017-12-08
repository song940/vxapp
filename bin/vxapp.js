#!/usr/bin/env node

/**
| node_modules | node_modules/@mtfe/vxapp | ^(node_modules/@mtfe/vxapp) | temp |
|--------------|--------------------------|-----------------------------|------|
| 0            | 0                        | 1                           | 0    |
| 1            | 0                        | 1                           | 1    |
| 1            | 1                        | 0                           | 0    |
| 1            | 1                        | 0                           | 0    |

temp = (node_modules) AND ^(node_modules/@mtfe/vxapp)

| node_modules/@mtfe/vxapp | temp | node_modules/@mtfe/vxapp/node_modules | ignore |
|--------------------------|------|---------------------------------------|--------|
| 0                        | 0    | 0                                     | 0      |
| 0                        | 1    | 0                                     | 1      |
| 1                        | 0    | 0                                     | 0      |
| 1                        | 0    | 1                                     | 1      |

ignore = temp OR (node_modules/@mtfe/vxapp/node_modules)
 */

const babelOptions = {
  ignore: x => {
    return /node_modules/i.test(x)
        && !/node_modules\/@mtfe\/vxapp/i.test(x)
        || /node_modules\/@mtfe\/vxapp(\/node_modules)/i.test(x);
  },
  presets: [
    require('babel-preset-es2015'),
    require('babel-preset-stage-0')
  ],
  plugins: [
    injectConfig()
  ]
};
require('babel-register')(babelOptions);

const fs      = require('fs');
const ncp     = require('ncp');
const path    = require('path');
const glob    = require('glob');
const mkdir   = require('mkdirp');
const babel   = require('babel-core');
const postcss = require('postcss');
const dedent  = require('dedent-js');
const program = require('commander');
const pkg     = require('../package');

require('upkg/updater')(pkg);

const cwd = process.cwd();
const src = path.join(cwd, 'src');
const conf = path.join(cwd, 'config');
const out = path.join(cwd, 'build');
const noop = x => x;
const envs = (function(e='dev') {
  let [first, ...rest] = [...new Set(e.split(',').filter(x => x !== 'default'))];
  const internalEnvs = ['dev', 'prod'];
  rest = rest.filter(x => {
    return internalEnvs.indexOf(x) === -1;
  });

  if (internalEnvs.indexOf(first) === -1) {
    return ['default', 'dev', first, ...rest];
  } else {
    return ['default', first, ...rest];
  }
})(process.env.NODE_ENV);
let ENV_OBJECT = {};

mkdir.sync(src);
mkdir.sync(conf);
mkdir.sync(out);

program
.command('new <project_name>')
.description('create project')
.action(name => {
  name = path.join(cwd, name);
  console.log('> cd', name);
  mkdir(name);
  init(name);
})

program
.command('init')
.description('init exists project')
.action(x => init(cwd));

program
.command('build')
.description('build source code')
.action(x => run())

program
.version(pkg.version)
.option('-w, --watch', 'watching files change')
.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}

function wxss(filename){
  const to = filename
    .replace(src, out)
    .replace(/\.css$/, '.wxss');
  fs.readFile(filename, (err, content) => {
    if(err) return;
    const paths = [
      path.dirname(filename),
      path.join(src, 'pages')
    ];
    postcss([
      require('postcss-advanced-variables')(),
      require('postcss-partial-import')({ path: paths }),
      require('postcss-nested')
    ])
    .process(content)
    .then(result => {
      fs.writeFile(to, result.css, noop);
    })
  })
}

function parseLayout(input){
  var name = (input.match(/layout:\s?(\w+)/) || [])[1];
  if(!name) return;
  name = name.trim();
  name += '.html';
  return fs.readFileSync(path.join(src, 'layouts', name), 'utf8');
}

function wxml(html){
  const wxml = html
    .replace(src, out)
    .replace(/\.html$/, '.wxml')
  mkdir.sync(path.dirname(wxml));
  const input = fs.readFileSync(html, 'utf8');
  var output = fs.readFileSync(html, 'utf8');
  const layout = parseLayout(output);
  if(layout) output = layout.replace('__view__', output);
  fs.writeFileSync(wxml, output);
}

function wxconfig(filename, files){
  delete require.cache[ filename ];
  const Page = require(filename)[ 'default' ];
  if(typeof Page === 'undefined' || !files) return;
  const config = Object.assign({}, Page.config);
  config.pages = [].concat.apply(config.pages, files)
  config.pages = config.pages.filter((x, i) => config.pages.indexOf(x) === i);
  const to = filename.replace(src, out).replace(/\.js$/, '.json')
  mkdir.sync(path.dirname(to));
  fs.writeFile(to, JSON.stringify(config), noop);
}

function addImport(code, name, pkg){
  return `import ${name} from '${pkg}';\n` + code;
}

function addRegister(code, type){
  var run = "$Run(exports['default'], Page, 'Page');";
  if(type === 'app') run = run.replace(/Page/g, 'App');
  return addImport(code, '{ $Run }', '@mtfe/vxapp') + run;
}

function transform(filename, type, to){
  fs.readFile(filename, 'utf8', (err, code) => {
    if(type === 'app' || type === 'page'){
      code = addRegister(code, type);
    }
    to = to || filename.replace(src, out);
    babelOptions.plugins = [ injectConfig(), parseImport(filename)  ];
    var result = babel.transform(code, babelOptions);
    mkdir(path.dirname(to), err => {
      fs.writeFile(to, result.code, noop);
    });
  });
}

function find(dirs, handle){
  return dirs.map(dir => glob.sync(dir)).reduce((a, b) => {
    return [].concat.apply(a, b);
  }, []);
}

function compile(filename){
  var type = 'other';
  const ext = filename.split('.').slice(-1)[0];
  if(/app\.js$/.test(filename)) type = 'app';
  if(/images/.test(filename)) type = 'image';
  if(/pages\/((?!_).)*\.js$/.test(filename)) type = 'page';
  const pages = glob.sync(src + '/pages/**/!(_)*.js').map(filename => {
    return filename.match(/(pages\/.*)\.js/)[1];
  });
  switch(ext){
    case 'js':
      transform(filename, type);
      wxconfig(filename, type === 'app' && pages);
      break;
    case 'css':
      wxss(path.join(src, 'app.css'));
      pages.forEach(page => wxss(path.join(src, page) + '.css'));
      break;
    case 'html':
      wxml(filename);
      break;
    default:
      if(type == 'image'){
        const to = filename.replace(src, out);
        mkdir.sync(path.dirname(to));
        fs.createReadStream(filename)
        .pipe(fs.createWriteStream(to));
      }
      break;
  }
}

function run(){

  // merge all envs
  mergeEnvironment(envs);

  find([
    src + '/app.js',
    src + '/app.css',
    src + '/pages/**/*.js',
    src + '/pages/**/*.html',
    src + '/pages/**/!(_)*.css',

    src + '/images/**/*',
    src + '/scripts/**/*.js'
  ]).forEach(compile);

}

function parseImport (current){
  const resolve = name => {
    try{
      return require.resolve(name);
    }catch(e){};
  }

  /**
   * /Users/weinliang/project/temp/vxapp/node_modules/@mtfe/tyto/xxx/index.js
   */
  const getPackageName = (filename) => {
    let p = filename;
    do{
      p = path.dirname(p);
      try{
        return require(path.join(p, 'package.json')).name;
      }catch(e){
        // nothing
      }
    } while(p !== '/' && p !== '.');
  }

  const replaceWithAlias = (name) => {
    // safe find module
    var requiredFilename = resolve(name);
    if(!requiredFilename) requiredFilename = path.resolve(path.dirname(current), name);
    // source
    if(/node_modules/.test(current)){
      const currentName = getPackageName(current) + '.js';
      current = path.join(out, 'scripts', currentName);
    }
    // target
    if(/node_modules/.test(requiredFilename)) {
      const to = path.join(out, 'scripts', getPackageName(requiredFilename)) + '.js';
      mkdir.sync(path.dirname(requiredFilename));
      transform(requiredFilename, null, to);
      requiredFilename = to;
    }
    requiredFilename = requiredFilename.replace(src, out);
    return path.relative(path.dirname(current.replace(src, out)), requiredFilename);
  }
  return {
    visitor: {
      CallExpression: function CallExpression(path) {
        // require
        var node = path.node;
        if (node.callee.name === "require" && node.arguments.length === 1) {
          var filepath = node.arguments[0].value;
          if (!filepath) return;
          node.arguments[0].value = replaceWithAlias(filepath);
          return;
        }
        // require.resolve
        var callee = node.callee;
        if (!callee.object) return;
        if (!callee.property) return;
        if (node.arguments.length !== 1) return;
        if (!node.arguments[0].value) return;

        if (callee.object.name == 'require' && callee.property.name == 'resolve') {
          node.arguments[0].value = replaceWithAlias(node.arguments[0].value);
        }
      }
    }
  };
}

function injectConfig() {
  return {
    visitor: {
      Literal: function(path) {
        if (path.node.value === 'VXAPP_CONFIG_STUB') {
          path.replaceWithSourceString(`exports.config=${JSON.stringify(ENV_OBJECT)}`)
        }
      }
    }
  }
}

function mergeEnvironment(names) {
  // find out all env files
  const envFiles = names.map(name => {
    return glob.sync(`${conf}/${name}?(.env).js`)
  }).reduce((a, b) => {
    return [].concat.apply(a, b);
  }, []);

  ENV_OBJECT = envFiles.reduce((config, filename) => {
    return Object.assign({}, config, (x => x && x.__esModule ? x.default : x)(require(filename)));
  }, {});
}

function init(dir){
  dir = dir || cwd;
  mkdir.sync(path.join(dir, 'src/pages/index'));

  // app.js
  fs.writeFile(path.join(dir, 'src/app.js'), dedent`
  import $ from '@mtfe/vxapp';

  export default class extends $.App {
    static config = {
      pages: [
        "pages/index/index",
      ],
      window: {
        navigationBarBackgroundColor: 'black',
        navigationBarTextStyle: 'white',
        navigationBarTitleText: $.config.libName,
        backgroundColor: 'grey',
        backgroundTextStyle: "#333"
      }
    }
    // your code here
  }`, noop);

  // app.css
  fs.writeFile(path.join(dir, 'src/app.css'), dedent`
    /* global stylesheets here */
  `, noop);

  // pages/index/index.js
  fs.writeFile(path.join(dir, 'src/pages/index/index.js'), dedent`
  import $ from '@mtfe/vxapp';

  export default class Index extends $.Page {
    initData () {
      return { name: $.config.libName };
    }
  }`, noop);
  // pages/index/index.html
  fs.writeFile(path.join(dir, 'src/pages/index/index.html'), dedent`
    <view>hello {{name}}</view>
  `, noop);

  // default.js
  fs.writeFile(path.join(dir, 'config/default.js'), dedent`
    // this file is generated by vxapp and will be used as a default environment
    export default {
      // your config goes here
      libName: 'vxapp'
    }
  `, noop);
  // together with prod and dev
  fs.writeFile(path.join(dir, 'config/prod.env.js'), dedent`
    // this file is generated by vxapp and will be used in production environment
    export default {
      // your config goes here
    }
  `, noop);
  fs.writeFile(path.join(dir, 'config/dev.env.js'), dedent`
    // this file is generated by vxapp and will be used in development environment
    export default {
      // your config goes here
    }
  `, noop);

  console.log('> npm i vxapp --save; vxapp build');
}

if(program.watch){
   process.on('uncaughtException', function (err) {
    console.error('uncaught exception:', err.message);
  })
  fs.watch(src, { recursive: true }, (type, filename) => {
    compile(path.join(src, filename));
  });
}