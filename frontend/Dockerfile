# Build the static site, then serve it with nginx (SPA fallback + /api proxy to the backend container).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_APP_NAME="Glass Luxury Store"
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_APP_NAME=$VITE_APP_NAME
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location /api/ { proxy_pass http://backend:8000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; }\n  location /media/ { proxy_pass http://backend:8000; }\n  location /sitemap.xml { proxy_pass http://backend:8000/api/v1/public/sitemap.xml; }\n  location / { try_files $uri /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
