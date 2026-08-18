import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { studentAuthInterceptor } from './app/auth/student-auth.interceptor';

// Path routing, not hash: CloudFront rewrites deep links to /index.html for
// anything that is not /api/* and has no file extension (the SPA fallback in
// aws/lib/landing-stack.ts), and the dev server does the same.
bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withInterceptors([studentAuthInterceptor])),
    provideRouter(routes),
  ],
}).catch((err) => console.error(err));
