const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

/** @type {import('webpack').Configuration[]} */
module.exports = [
  // Extension bundle (Node.js)
  {
    target: 'node',
    entry: './src/extension.ts',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'extension.js',
      libraryTarget: 'commonjs2',
      devtoolModuleFilenameTemplate: '../[resource-path]'
    },
    devtool: 'source-map',
    externals: {
      vscode: 'commonjs vscode'
    },
    resolve: {
      extensions: ['.ts', '.js']
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [{ loader: 'ts-loader' }]
        }
      ]
    }
  },
  // Webview bundle (Browser)
  {
    target: 'web',
    entry: './src/webview/app.ts',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'webview.js',
    },
    devtool: 'source-map',
    resolve: {
      extensions: ['.ts', '.js']
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [{
            loader: 'ts-loader',
            options: {
              compilerOptions: {
                lib: ['ES2021', 'DOM'],
                target: 'ES2021',
                module: 'es2020',
                moduleResolution: 'bundler',
                resolveJsonModule: true,
              }
            }
          }]
        }
      ]
    }
  },
  // CSS copy (no-op entry, just copies assets)
  {
    entry: {},
    plugins: [
      new CopyPlugin({
        patterns: [
          { from: 'src/webview/style.css', to: 'style.css' }
        ]
      })
    ]
  }
];
