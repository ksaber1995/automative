import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { portalAuthInterceptor } from './app/auth/portal-auth.interceptor';

// Every call to the admin API carries the portal token, and a 401 ends the
// session — see portal-auth.interceptor.ts.
//
// Path routing, not hash: CloudFront rewrites deep links to /index.html for
// anything that is not /api/* and has no file extension (the SPA fallback
// function in aws/lib/landing-stack.ts), and the dev server does the same, so
// reloading on /cards serves the app rather than a 404.
bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withInterceptors([portalAuthInterceptor])),
    provideRouter(
      routes,
      // Opening a client sheet from halfway down a long table should not also
      // jump the page; only a real section change starts at the top.
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'disabled' }),
    ),
  ],
}).catch((err) => console.error(err));
