import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { portalAuthInterceptor } from './app/auth/portal-auth.interceptor';

// Every call to the admin API carries the portal token, and a 401 ends the
// session — see portal-auth.interceptor.ts.
bootstrapApplication(AppComponent, {
  providers: [provideHttpClient(withInterceptors([portalAuthInterceptor]))],
}).catch((err) => console.error(err));
