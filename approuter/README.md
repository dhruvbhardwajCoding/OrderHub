# Northwind Order Hub — App Router

Routes browser requests to the deployed CAP backend (`orderhub-srv`) and
handles XSUAA login. Serves the UI5 app statically; `webapp/` is not
committed — regenerate it before deploying:

```sh
cp -r ../frontend/orderhub ./webapp
cf push -f manifest.yml
```
