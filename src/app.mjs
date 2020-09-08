//Imports
  import express from "express"
  import fs from "fs"
  import path from "path"
  import octokit from "@octokit/graphql"
  import cache from "memory-cache"
  import ratelimit from "express-rate-limit"
  import metrics from "./metrics.mjs"

//Load svg template, style and query
  async function load() {
    return await Promise.all(["template.svg", "style.css", "query.graphql"].map(async file => `${await fs.promises.readFile(path.join("src", file))}`))
  }

//Setup
  export default async function setup() {

    //Load settings
      const settings = JSON.parse((await fs.promises.readFile(path.join("settings.json"))).toString())
      console.log(settings)
      const {token, maxusers = 0, restricted = [], debug = false, cached = 30*60*1000, port = 3000, ratelimiter = null} = settings
    //Load svg template, style and query
      let [template, style, query] = await load()
      const graphql = octokit.graphql.defaults({headers:{authorization: `token ${token}`}})

    //Setup server
      const app = express()
      const middlewares = []
    //Rate limiter middleware
      if (ratelimiter) {
        app.set("trust proxy", 1)
        middlewares.push(ratelimit({
          skip(req, res) { return !!cache.get(req.params.login) },
          message:"Too many requests",
          ...ratelimiter
        }))
      }
    //Cache headers middleware
      middlewares.push((req, res, next) => {
        res.header("Cache-Control", cached ? `public, max-age=${cached}` : "no-store, no-cache")
        next()
      })

    //Base routes
      app.get("/", (req, res) => res.redirect("https://github.com/lowlighter/metrics"))
      app.get("/favicon.ico", (req, res) => res.sendStatus(204))

    //Metrics
      app.get("/:login", ...middlewares, async (req, res) => {

        //Request params
          const {login} = req.params
          if ((restricted.length)&&(!restricted.includes(login)))
            return res.sendStatus(403)

        //Read cached data if possible
          if ((!debug)&&(cached)&&(cache.get(login))) {
            res.header("Content-Type", "image/svg+xml")
            res.send(cache.get(login))
            return
          }
        //Maximum simultaneous users
          if ((maxusers)&&(cache.size()+1 > maxusers))
            return res.sendStatus(503)

        //Compute rendering
          try {
            //Render
              if (debug)
                [template, style, query] = await load()
              const rendered = await metrics({login}, {template, style, query, graphql})
            //Cache
              if ((!debug)&&(cached))
                cache.put(login, rendered, cached)
            //Send response
              res.header("Content-Type", "image/svg+xml")
              res.send(rendered)
          }
        //Internal error
          catch (error) {
            //Not found user
              if ((error instanceof Error)&&(/^user not found$/.test(error.message)))
                return res.sendStatus(404)
            //General error
              console.error(error)
              res.sendStatus(500)
          }
      })

    //Listen
      app.listen(port, () => console.log([
        `Listening on port      | ${port}`,
        `Debug mode             | ${debug}`,
        `Restricted to users    | ${restricted.size ? [...restricted].join(", ") : "(unrestricted)"}`,
        `Cached time            | ${cached} seconds`,
        `Rate limiter           | ${ratelimiter ? JSON.stringify(ratelimiter) : "(enabled)"}`,
        `Max simultaneous users | ${maxusers ? `${maxusers} users` : "(unrestricted)"}`
      ].join("\n")))
  }