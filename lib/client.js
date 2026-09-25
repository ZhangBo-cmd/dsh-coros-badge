// dsh-coros-badge —— 浏览器（Client）半边。
// 常驻显示「手表型号 + 累计运动天数」，点击展开一句话点评与建议。
// 数据来自宿主侧 /coros-summary 接口（读本地 token，不出本机）。
window.__ModuleLoader__.load({
  id: "dsh-coros-badge",
  factory: function (require) {
    var React = require("react");
    var inject = ["slots"];

    function el(type, props) {
      var children = Array.prototype.slice.call(arguments, 2);
      return React.createElement.apply(React, [type, props].concat(children));
    }

    var pillStyle = {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      padding: "2px 10px",
      borderRadius: "24px",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      color: "var(--dsw-alias-label-tertiary, #9aa0aa)",
      fontFamily: "inherit",
      fontSize: "12px",
      lineHeight: "20px",
      whiteSpace: "nowrap",
    };

    var panelStyle = {
      position: "fixed",
      left: "12px",
      bottom: "68px",
      width: "320px",
      maxWidth: "calc(100vw - 24px)",
      maxHeight: "70vh",
      overflow: "auto",
      background: "rgba(24, 26, 32, 0.98)",
      color: "#e8e8ec",
      borderRadius: "12px",
      padding: "14px",
      boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
      border: "1px solid rgba(255,255,255,0.08)",
      zIndex: 9999,
      fontSize: "12px",
      lineHeight: "1.55",
    };

    var titleStyle = { fontWeight: 600, fontSize: "13px", marginBottom: "8px" };
    var rowStyle = { marginBottom: "4px", color: "#c6cbd4" };
    var keyStyle = { color: "#9aa0aa" };
    var sepStyle = { height: "1px", background: "rgba(255,255,255,0.10)", margin: "8px 0" };
    var lineStyle = { marginBottom: "6px" };

    // 高驰官方 Logo（品牌三角标，fill 跟随文字颜色），替代蓝紫色的 ⌚ emoji
    function CorosIcon() {
      return el(
        "svg",
        {
          viewBox: "0 0 1024 1024",
          width: "14",
          height: "14",
          fill: "#F8273B",
          "aria-hidden": "true",
        },
        el("path", {
          d: "M611.28637781 226.3848448l313.2594324 182.00737337L925.07539342 786.3244288 612.34554539 967.44210091l-52.8312832-28.51279417 245.1761334-182.36749028L804.22436181 437.85826304 562.20454798 254.81290525l49.08182983-28.42806045zM171.15984213 335.14018133l34.86779961 304.15059058 275.38359524 158.95988452 279.04831715-118.71151332v56.85612089l-313.7678336 181.11767325L120.10795918 728.9599067V366.78811193l51.03069867-31.62674745zM569.19505465 56.55789909l312.72984804 181.11767211 1.80058566 60.13954162-280.04393414-121.80428345-274.9175626 159.76485205-37.02850219 301.75687111-49.06064668-28.42806044 0.50840121-363.12504548L569.19505465 56.55789909z",
        }),
      );
    }

    function CorosBadge() {
      var dataRef = React.useState(null);
      var data = dataRef[0];
      var setData = dataRef[1];
      var openRef = React.useState(false);
      var open = openRef[0];
      var setOpen = openRef[1];

      React.useEffect(function () {
        var cancelled = false;
        function load() {
          fetch("/coros-summary")
            .then(function (r) { return r.json(); })
            .then(function (j) { if (!cancelled) setData(j); })
            .catch(function () {});
        }
        load();
        var id = setInterval(load, 30 * 60 * 1000);
        return function () { cancelled = true; clearInterval(id); };
      }, []);

      var text;
      if (!data) text = "高驰加载中…";
      else if (!data.ok) text = "高驰未连接";
      else text = (data.model || "COROS") + " · 运动 " + data.totalDays + " 天";

      return el(
        "div",
        { style: { display: "inline-flex", alignItems: "center" } },
        el(
          "button",
          {
            onClick: function () { setOpen(function (v) { return !v; }); },
            title: "高驰训练概览（点击展开）",
            style: pillStyle,
          },
          el(CorosIcon),
          el("span", null, text),
        ),
        open && data && data.ok ? el(BadgePanel, { data: data }) : null,
      );
    }

    function BadgePanel(props) {
      var d = props.data;
      return el(
        "div",
        { style: panelStyle },
        el("div", { style: titleStyle }, "高驰训练概览"),
        el("div", { style: rowStyle }, el("span", { style: keyStyle }, "手表："), d.model),
        el("div", { style: rowStyle }, el("span", { style: keyStyle }, "累计运动天数："), d.totalDays, " 天"),
        el("div", { style: rowStyle }, el("span", { style: keyStyle }, "近30天："), d.recentDays, " 天 / ", d.recentKm, " km"),
        d.recovery != null
          ? el("div", { style: rowStyle }, el("span", { style: keyStyle }, "恢复度："), d.recovery, "%")
          : null,
        el("div", { style: sepStyle }),
        el("div", { style: lineStyle }, el("span", { style: keyStyle }, "点评："), d.comment),
        el("div", { style: lineStyle }, el("span", { style: keyStyle }, "建议："), d.suggestion),
      );
    }

    function apply(ctx) {
      ctx.slots.inject("conversation.input.left", function () {
        return ctx.slots.register(
          { name: "conversation.input.left", id: "coros-badge", order: 100 },
          CorosBadge,
        );
      });
    }

    return { apply: apply, inject: inject };
  },
});
