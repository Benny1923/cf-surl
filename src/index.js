/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npx wrangler dev src/index.js` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npx wrangler publish src/index.js --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { getAssetFromKV, mapRequestToAsset } from '@cloudflare/kv-asset-handler'

const DEBUG = true

const PIN = 0000

addEventListener('fetch', event => {
  event.respondWith(handleEvent(event))
})

class NotFoundError extends Error {
  constructor(msg) {
    super(msg)
    this.name = "NotFoundError"
  }
}

class AuthenticationFailed extends Error {
  constructor(msg) {
    super(msg)
    this.name = "AuthenticationFailed"
  }
}

async function handleEvent(event) {
  let url = new URL(event.request.url)
  let path = url.pathname
  try {
    if (path == "/") {
      let page = await getAssetFromKV(event)
      return new Response(page.body, page);
    } else if (path.startsWith('/api/')) {
      return await apiRouter(event, path.slice(5))
    } else if (/^\/[\w\d]{5}(\.[\w\d]+)?$/.test(path)) {
      return await redirectTo(path.slice(1))
    }
    throw new NotFoundError("route not found.")
  } catch (error) {
    if (error instanceof NotFoundError) {
      let page = await getAssetFromKV(event, { mapRequestToAsset: staticResource('404.html')})
      let response = new Response(page.body, {
        status: 404
      })
      return response
    } else if (error instanceof AuthenticationFailed) {
      return new Response('accept your fate, son.', {
        status: 302,
        headers: {
          "location": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        }
      })
    }
    if (DEBUG) {
      return new Response(error.stack)
    } else {
      return new Response("oops, server failed.", {
        status: 500
      })
    }
  }
}

function staticResource(name) {
  return request => {
    let url = new URL(request.url)
    url.pathname = '/'+name
    return mapRequestToAsset(new Request(url, {method: "GET"}))
  }
}

async function apiRouter(event, path) {
  let request = event.request.clone()
  let pincode, data
  switch (path) {
    case 'form':
      if (request.method != "POST") throw new NotFoundError()
      let form = await request.formData()
      pincode = form.get("pincode")
      if (pincode != PIN.toString()) throw new AuthenticationFailed("pin is not correct")
      data = await setURL(form.get('origurl'))
      let page = await getAssetFromKV(event, { mapRequestToAsset: staticResource('okay.html')})
      let html = await page.text()
      let response =  new Response(html.replace('RENDER_DATA', JSON.stringify(data)), page)
      response.headers.set("Set-Cookie", "pincode="+pincode+"; Path=/")
      return response
      break
    case 'set':
      if (request.method != "POST") throw new NotFoundError()
      let content = await request.json()
      pincode = content['pincode']
      if (pincode != PIN.toString()) throw new AuthenticationFailed("pin is not correct")
      data = await setURL(content['url'], content['prefix'])
      return new Response(JSON.stringify(data), {
        headers: {
          "Content-Type": 'application/json'
        }
      })
      break
    case 'delete':
      // break
    case 'list':
      // break
    default:
      throw new NotFoundError('api not found')
      break
  }
}

async function redirectTo(key) {
  let [index, prefix] = key.split('.')
  let data = await getURL(index)
  if (!data || (prefix && prefix != data.prefix)) throw new NotFoundError("navId not found.")
  return new Response('Redirect...', {
    status: 302,
    headers: {
      "location": data.url
    }
  })
}

function genId() {
  let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i=0;i<5;i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length))
  }
  return result
}

function newData(src, prefix = undefined) {
  return {url: src, prefix, timestamp: (new Date()).getTime()}
}

const expireTime = 60 * 60 * 24 * 183

async function setURL(src, prefix = undefined) {
  new URL(src)
  let index = genId()
  let try_count = 3
  for (let i=0;i<try_count;i++) {
    if (!(await getURL(index))) break
    index = genId()
    if (i == try_count - 1) throw new Error("generate random id failed.")
  }
  let data = newData(src, prefix)
  await URL_DB.put(index, JSON.stringify(data), {expirationTtl: expireTime})
  return {index, ...data}
}

async function getURL(index) {
  let data = JSON.parse(await URL_DB.get(index))
  if (!data) return false
  return {index, ...data}
}
