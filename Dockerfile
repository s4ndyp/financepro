# Use the official NGINX image as base
FROM nginx:alpine

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy application files to NGINX html directory
COPY index.html /usr/share/nginx/html/
COPY logic.js /usr/share/nginx/html/
COPY styles.css /usr/share/nginx/html/
COPY offline_manager.js /usr/share/nginx/html/

# Expose port 80
EXPOSE 80

# Start NGINX
CMD ["nginx", "-g", "daemon off;"]
