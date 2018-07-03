const fetch = require('node-fetch')
const { foreach } = require('./helpers')

const auth = { 'Authorization': 'token ' + process.env.GITHUB_TOKEN }
const get_notifications = () => fetch('https://api.github.com/notifications', {
	headers: { ...auth }
}).then(res => res.json())

const graphql = (query) => fetch('https://api.github.com/graphql', {
	body: JSON.stringify({ query: query }),
	method: 'POST',
	headers: { ...auth }
}).then(res => res.json())

const patch_notification = (thread) => fetch(`https://api.github.com/notifications/threads/${thread}`, {
	method: 'PATCH',
	headers: { ...auth }
})

const build_agenda = () => {
	return get_notifications().then((json) => {
		let agenda = {}
		json.map((notif) => {
			let repo = notif.repository.name
			let owner = notif.repository.owner.login
			let repo_id = "r" + notif.repository.owner.id + "_" + notif.repository.id
			let url = notif.subject.url
			let typ = notif.subject.type
			typ = typ.charAt(0).toLowerCase() + typ.substr(1)
			let urlparts = url.split('/')
			let number = urlparts[ urlparts.length - 1 ]
			if( notif.subject.latest_comment_url ){
				url = notif.subject.latest_comment_url
			}

			if( typeof agenda[repo_id] === "undefined" ){
				agenda[repo_id] = {
					"owner": owner,
					"repo": repo,
					"nodes": {},
				}
			}

			agenda[repo_id].nodes["i"+number] = {
				"thread_id": notif.id,
				"type": typ,
				"number": number,
				"url": url,
				"reason": notif.reason,
				"repo": repo,
				"updated_at": notif.updated_at,
			}
			return notif
		})
		return agenda
	})
}

const build_graphql_query = (agenda) => {
	let q = "{\n"
	foreach(agenda, (repo_id, repo) => {
		q += `${repo_id}: repository(owner: "${repo.owner}", name: "${repo.repo}") {\n`
		foreach(repo.nodes, (key, item) => {
			q += `
				${key}: issueOrPullRequest(number: ${item.number}) {
					__typename
					...issuedata
					...prdata
				}
			`
		})
		q += "\n}\n"
	})
	q += `
	}
	fragment issuedata on Issue {
		id
		url
		title
		number
		closed
		timeline(last:1){ edges { node { ...timelinedata } } }
		labels(first:5){ edges { node { name color } } }
	}
	fragment prdata on PullRequest {
		id
		url
		title
		number
		state
		timeline(last:1){ edges { node { ...timelinedata } } }
		labels(first:5){ edges { node { name color } } }
	}
	fragment timelinedata on Node {
		__typename
		... on UniformResourceLocatable { url }
		... on IssueComment { url }
		... on Commit { url }
		... on Issue { url }
	}
	`
	return q
}

const query_notifications = (q, agenda) => {
	return graphql(q).then((result) => {
		foreach(result.data, (repo_id, repo) => {
			foreach(repo, (key, d) => {
				let state = d["state"] || ( d["closed"] ? "CLOSED" : "OPEN" )
				Object.assign( agenda[repo_id]["nodes"][key], d )
				agenda[repo_id]["nodes"][key]["state"] = state

				if( d.timeline.edges.length > 0 ){
					let node = d.timeline.edges[0].node
					agenda[repo_id].nodes[key].latest = {
						"type": node.__typename,
						"url":  node["url"],
					}
					delete agenda[repo_id].nodes[key].timeline
				}
				agenda[repo_id].nodes[key].labels = []
				if( d.labels.edges.length > 0 ){
					for(e in d.labels.edges){
						let node = d.labels.edges[e].node
						agenda[repo_id].nodes[key].labels.push({
							...node
						})
					}
				}
			})
		})
		return agenda
	})
}

const build_graphql_mutation = (node_id) => {
	return `
	mutation Unsub {
		updateSubscription(input:{
			subscribableId: "${node_id}",
			state: IGNORED
		}){
			subscribable {
				id
				viewerSubscription
			}
		}
	}
	`
}

module.exports = {
	get_notifications,
	patch_notification,
	graphql,
	build_agenda,
	build_graphql_query,
	build_graphql_mutation,
	query_notifications
}