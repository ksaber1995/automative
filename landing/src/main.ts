import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { LandingComponent } from './app/landing.component';

bootstrapApplication(LandingComponent, {
  providers: [
    provideHttpClient(),
    provideTranslateService({ defaultLanguage: 'en' }),
    ...provideTranslateHttpLoader({ prefix: 'i18n/', suffix: '.json' }),
  ],
}).catch((err) => console.error(err));
