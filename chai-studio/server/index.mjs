import {createApp} from './app.mjs';
const port=Number(process.env.PORT||8001);
const host=process.env.HOST||'127.0.0.1';
createApp().listen(port,host,()=>console.log(`Muse är igång på http://${host}:${port}. Låt Terminal vara öppet.`));
