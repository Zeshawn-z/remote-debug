const path = require('path');

module.exports = (env, argv) => {
  const config = {
    target: ['web', 'es5'],
    entry: {
      index: './src/index.tsx',
      bind: './src/bind.ts',
      target: {
        import: './src/target.ts',
        library: {
          name: 'chii',
          type: 'umd',
        },
      },
    },
    devtool: 'inline-source-map',
    output: {
      filename: '[name].js',
      path: path.resolve(__dirname, 'public'),
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          loader: 'ts-loader',
        },
        {
          test: /\.svg$/,
          loader: 'svg-url-loader',
        },
        {
          test: /\.module\.css$/i,
          use: [
            'style-loader',
            {
              loader: 'css-loader',
              options: {
                modules: {
                  localIdentName: '[name]__[local]--[hash:base64:5]',
                },
              },
            },
          ],
        },
        {
          test: /\.css$/i,
          exclude: /\.module\.css$/i,
          use: ['style-loader', 'css-loader'],
        },
      ],
    },
  };

  if (argv.mode === 'production') {
    delete config.devtool;
  }

  return config;
};
