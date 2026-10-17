import {getThemeBootScript, getThemeCSS} from 'expo-interface';
import {ScrollViewStyleReset} from 'expo-router/html';
import type {PropsWithChildren} from 'react';

export default function Root({children}: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <title>Test App</title>
        <style dangerouslySetInnerHTML={{__html: getThemeCSS()}} />
        {/* A scheme forced with setColorScheme, applied before the bundle runs. */}
        <script dangerouslySetInnerHTML={{__html: getThemeBootScript()}} />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
